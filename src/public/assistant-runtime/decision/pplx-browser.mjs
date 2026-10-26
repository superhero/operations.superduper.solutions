import {Tokenizer} from './vendor/hf-tokenizers/tokenizers.mjs';
import {Template} from './vendor/hf-jinja/index.js';
import {preparePplxRequest, normalizePplxAnswer, PPLX_CODEBOOK} from './pplx-prompt.mjs';
import {fetchTextProgress} from './load-progress.mjs';

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function equivalent(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equivalent(value, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equivalent(a[key], b[key]));
  return a === b;
}

export async function preparePplx(profile, inputs, reference, onProgress) {
  const probe = profile.browser_probe;
  const base = `https://huggingface.co/${probe.prompt_model}/resolve/${probe.prompt_revision}/`;
  const assets = Object.fromEntries(await Promise.all(['tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja'].map(async name => {
    const text = await fetchTextProgress(base + name, {key: 'tokenizer/' + name, label: name,
      onProgress: load => onProgress('pplx-tokenizer', {file: name, load})});
    if (reference?.asset_sha256?.[name] && await digest(text) !== reference.asset_sha256[name]) throw Error('Browser/publisher asset differs: ' + name);
    return [name, text];
  })));
  const config = JSON.parse(assets['tokenizer_config.json']);
  const tokenizer = new Tokenizer(JSON.parse(assets['tokenizer.json']), config);
  const template = new Template(assets['chat_template.jinja']);
  const specials = Object.fromEntries(Object.entries(config).filter(([key]) => key.endsWith('_token')).map(([key, value]) => [key, value?.content ?? value]));
  const environment = {
    encode: text => tokenizer.encode(text, {add_special_tokens: false}).ids,
    decode: ids => tokenizer.decode(ids, {skip_special_tokens: false, clean_up_tokenization_spaces: false}),
    applyChatTemplate: (messages, kwargs) => template.render({...specials, ...kwargs, messages}),
  };
  if (reference && !equivalent(reference.codebook, PPLX_CODEBOOK)) throw Error('Publisher source/GGUF codebook differs from the browser constants');
  const prepared = [];
  const prepareRequest = request => preparePplxRequest(request, environment, {maxTokens: Number.MAX_SAFE_INTEGER});
  for (const fixture of inputs) {
    const request = preparePplxRequest(fixture.request, environment, {maxTokens: profile.settings.max_rendered_prompt_tokens});
    if (reference) {
      const expected = reference.records.find(record => record.id === fixture.id);
      if (!expected || !equivalent(expected.request, fixture.request) || !equivalent(expected.expected, request)) throw Error('Browser prompt/token/marker differs from publisher Python: ' + fixture.id);
    }
    prepared.push({fixture, request, prompt_sha256: await digest(request.prompt)});
  }
  return {prepared, prepareRequest, tokenizeText: environment.encode, reference_verified: Boolean(reference) && inputs.length > 0, source: {model: probe.prompt_model, revision: probe.prompt_revision},
    gguf_metadata_verified: Boolean(reference), temperature: PPLX_CODEBOOK.temperature};
}

export async function scorePplx(model, fixture, prepared, {onForward = () => {}} = {}) {
  const raw = await model.createInlineReadout({token_ids: prepared.tokens, readout_index: prepared.readoutIndex, label_ids: prepared.labelTokenIds});
  onForward(raw);
  const d = raw.diagnostics;
  if (!equivalent(raw.label_ids, prepared.labelTokenIds) || !equivalent(raw.label_pieces, prepared.labels) ||
      raw.logits?.length !== prepared.labelTokenIds.length || !raw.logits.every(Number.isFinite)) throw Error('Native Perplexity code IDs/pieces/logits differ');
  if (d?.decode_calls !== 1 || d.input_tokens !== prepared.tokens.length ||
      !equivalent(d.microbatches, [{start: 0, length: prepared.tokens.length}]) ||
      d.readout_index !== prepared.readoutIndex || d.readout_token_id !== prepared.markerId || d.marker_count !== 1 ||
      d.trailing_tokens !== prepared.trailingTokens || d.final_cache_position !== prepared.tokens.length - 1 ||
      d.protocol_version !== 3 || d.template !== prepared.template || d.model_architecture !== 'qwen35' ||
      d.causal_full_attention !== false || d.causal_recurrent_attention !== true || d.sampled_tokens !== 0 ||
      d.cache_reset !== true || d.causal_state_restored !== true || d.cache_cleared_after !== true) throw Error('Native Perplexity whole-prompt inline-marker contract differs');
  const normalized = normalizePplxAnswer(fixture.request.questions.q, raw.logits, {temperature: prepared.temperature});
  return {answer: normalized.answer, raw: {...raw, native_response_sha256: await digest(JSON.stringify(raw)),
    label_temperature: prepared.temperature, offered_keys: prepared.offeredKeys, label_token_ids: prepared.labelTokenIds,
    rendered_tokens: prepared.tokens.length, offered_label_coverage_verified: true}};
}
