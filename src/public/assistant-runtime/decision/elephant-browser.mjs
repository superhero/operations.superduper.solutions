import {Tokenizer} from './vendor/hf-tokenizers/tokenizers.mjs';
import {Template} from './vendor/hf-jinja/index.js';
import {prepareElephantRequest, elephantOffsetEncoding, normalizeElephantAnswer} from './elephant-prompt.mjs';
import {fetchTextProgress} from './load-progress.mjs';

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
const equivalent = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, i) => equivalent(value, right[i]));
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    return Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every(key => Object.hasOwn(right, key) && equivalent(left[key], right[key]));
  }
  return left === right;
};

export async function prepareElephant(profile, inputs, reference, onProgress) {
  const probe = profile.browser_probe;
  const base = `https://huggingface.co/${probe.prompt_model}/resolve/${probe.prompt_revision}/`;
  const assets = Object.fromEntries(await Promise.all(['tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja'].map(async name => {
    const text = await fetchTextProgress(base + name, {key: 'tokenizer/' + name, label: name,
      onProgress: load => onProgress('elephant-tokenizer', {file: name, load})});
    if (reference?.asset_sha256?.[name] && await digest(text) !== reference.asset_sha256[name]) {
      throw Error('Browser/publisher asset differs: ' + name);
    }
    return [name, text];
  })));
  const config = JSON.parse(assets['tokenizer_config.json']);
  const tokenizer = new Tokenizer(JSON.parse(assets['tokenizer.json']), config);
  const template = new Template(assets['chat_template.jinja']);
  const specials = Object.fromEntries(Object.entries(config).filter(([key]) => key.endsWith('_token'))
    .map(([key, value]) => [key, value?.content ?? value]));
  const environment = {
    encode: text => tokenizer.encode(text, {add_special_tokens: false}).ids,
    decode: ids => tokenizer.decode(ids, {skip_special_tokens: false}),
    encodeWithOffsets: text => elephantOffsetEncoding(text, tokenizer.encode(text, {add_special_tokens: false})),
    applyChatTemplate: (messages, kwargs) => template.render({...specials, ...kwargs, messages}),
  };
  const prepared = [];
  const prepareRequest = request => prepareElephantRequest(request, environment, {maxTokens: Number.MAX_SAFE_INTEGER});
  for (const fixture of inputs) {
    const request = prepareElephantRequest(fixture.request, environment, {maxTokens: profile.settings.max_rendered_prompt_tokens});
    if (reference) {
      const expected = reference.records.find(record => record.id === fixture.id);
      if (!expected || !equivalent(expected.request, fixture.request) || !equivalent(expected.expected, request)) {
        throw Error('Browser prompt/token/boundary differs from publisher Python: ' + fixture.id);
      }
    }
    prepared.push({fixture, request, prompt_sha256: await digest(request.prompt)});
  }
  return {prepared, prepareRequest, tokenizeText: environment.encode, reference_verified: Boolean(reference) && inputs.length > 0,
    source: {model: probe.prompt_model, revision: probe.prompt_revision}};
}

export async function scoreElephant(model, fixture, prepared, {onForward = () => {}} = {}) {
  const prefix = prepared.prefixTokens.length, suffix = prepared.suffixTokens.length;
  const raw = await model.createBlockReadout({prefix_ids: prepared.prefixTokens, suffix_ids: prepared.suffixTokens,
    label_ids: prepared.labelTokenIds, readout_suffix_index: suffix - 1});
  onForward(raw);
  const d = raw.diagnostics;
  if (!equivalent(raw.label_ids, prepared.labelTokenIds) ||
      !equivalent(raw.label_pieces, prepared.labels) ||
      raw.logits?.length !== prepared.labelTokenIds.length || !raw.logits.every(Number.isFinite)) {
    throw Error('Native Elephant slot IDs/pieces/logits do not match offered labels');
  }
  if (d?.decode_calls !== 2 || d.prefix_tokens !== prefix || d.suffix_tokens !== suffix ||
      d.input_tokens !== prepared.tokens.length ||
      !equivalent(d.microbatches, [{start: 0, length: prefix}, {start: prefix, length: suffix}]) ||
      d.causal_full_attention !== false || d.causal_recurrent_attention !== true ||
      d.cache_reset !== true || d.cache_preserved_between_blocks !== true ||
      d.readout_suffix_index !== suffix - 1 || d.sampled_tokens !== 0 ||
      d.causal_state_restored !== true || d.cache_cleared_after !== true || d.model_architecture !== 'qwen35') {
    throw Error('Native Elephant two-block attention/readout diagnostics differ from the publisher contract');
  }
  if (!(Number.isFinite(raw.allowed_token_mass) && raw.allowed_token_mass >= 0 && raw.allowed_token_mass <= 1)) {
    throw Error('Invalid native allowed-token mass');
  }
  const normalized = normalizeElephantAnswer(fixture.request.questions.q, raw.logits, {allowedTokenMass: raw.allowed_token_mass});
  return {answer: normalized.answer, probabilities: normalized.probabilities,
    raw: {...raw, native_response_sha256: await digest(JSON.stringify(raw)), label_temperature: 1,
      offered_keys: prepared.offeredKeys, label_token_ids: prepared.labelTokenIds,
      rendered_tokens: prepared.tokens.length, offered_label_coverage_verified: true}};
}
