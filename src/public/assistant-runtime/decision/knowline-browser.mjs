import {Tokenizer} from './vendor/hf-tokenizers/tokenizers.mjs';
import {Template} from './vendor/hf-jinja/index.js';
import {prepareKnowLineRequest} from './knowline-prompt.mjs';
import {fetchTextProgress} from './load-progress.mjs';
import {assertInputBudget, knowLinePromptBudget} from './context-guard.mjs';

const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
export async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Native text rendering/tokenization only; no model or answer gold here. */
export async function prepareKnowLine(profile, inputs, reference, onProgress) {
  const probe = profile.browser_probe;
  const base = `https://huggingface.co/${probe.prompt_model}/resolve/${probe.prompt_revision}/`;
  const assets = Object.fromEntries(await Promise.all(['tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja'].map(async name => {
    const text = await fetchTextProgress(base + name, {key: 'tokenizer/' + name, label: name,
      onProgress: load => onProgress('knowline-tokenizer', {file: name, load})});
    if (reference?.asset_sha256?.[name] && await digest(text) !== reference.asset_sha256[name]) {
      throw Error('Browser/native reference asset differs: ' + name);
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
    applyChatTemplate: (messages, kwargs) => template.render({...specials, ...kwargs, messages}),
  };
  const prepared = [];
  const prepareRequest = request => prepareKnowLineRequest(request, environment, {maxTokens: Number.MAX_SAFE_INTEGER});
  for (const fixture of inputs) {
    const request = prepareKnowLineRequest(fixture.request, environment, {maxTokens: knowLinePromptBudget(profile)});
    if (reference) {
      const expected = reference.records.find(record => record.id === fixture.id);
      if (!expected || JSON.stringify(expected.request) !== JSON.stringify(fixture.request) ||
          JSON.stringify(expected.expected) !== JSON.stringify(request)) {
        throw Error('Browser prompt/tokenization differs from publisher Python: ' + fixture.id);
      }
    }
    prepared.push({fixture, request, prompt_sha256: await digest(request.prompt)});
  }
  return {prepared, prepareRequest, tokenizeText: environment.encode, reference_verified: Boolean(reference) && inputs.length > 0,
    source: {model: probe.prompt_model, revision: probe.prompt_revision}};
}

/** Select ORIGINAL native token logprobs. The one sampled token is discarded. */
export async function scoreKnowLine(model, prepared, {logprobsLimit, onForward = () => {}} = {}) {
  const info = model.getLoadedContextInfo(), vocabularySize = info.n_vocab;
  assertInputBudget(prepared, {harnessLimit: info.n_ctx - 1, contextSize: info.n_ctx, reservedTokens: 1});
  const count = Math.min(vocabularySize, logprobsLimit ?? vocabularySize);
  const response = await model.createCompletion({
    prompt: prepared.prompt, stream: false, max_tokens: 1, logprobs: count,
    post_sampling_probs: false, backend_sampling: false, samplers: [],
    mirostat: 0, temperature: 1, cache_prompt: false, stop: [], seed: 42,
  });
  onForward(response);
  const positions = response.choices?.[0]?.logprobs?.content;
  const vocabulary = positions?.[0]?.top_logprobs;
  if (positions?.length !== 1 || vocabulary?.length !== count ||
      new Set(vocabulary.map(token => token.id)).size !== count) {
    throw Error('Native raw readout did not return the requested unique token probabilities');
  }
  if (response.usage?.prompt_tokens !== prepared.tokens.length) throw Error('Native/browser prompt token count differs');
  const ids = new Set(prepared.labelTokenIds);
  const found = new Map(vocabulary.filter(token => ids.has(token.id)).map(token => [token.id, token]));
  const selected = prepared.labelTokenIds.map(id => found.get(id));
  if (selected.some(token => !token || !Number.isFinite(token.logprob) || token.logprob < -1e30)) {
    throw Error('An offered label has missing, nonfinite or underflowed native logprob');
  }
  if (selected.some((token, index) => token.token.trim() !== prepared.labels[index])) {
    throw Error('Native token IDs do not decode to the publisher labels');
  }
  const peak = Math.max(...selected.map(token => token.logprob));
  const weights = selected.map(token => Math.exp(token.logprob - peak));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const probabilities = Object.fromEntries(prepared.offeredKeys.map((key, i) => [key, weights[i] / total]));
  const entropy = Object.values(probabilities).reduce((sum, p) => sum - (p > 0 ? p * Math.log(p) : 0), 0);
  const confidence = Math.min(1, Math.max(0, 1 - entropy / Math.log(weights.length)));
  // Native raw logprobs normalize over the FULL vocabulary before returning
  // the top N. Complete label coverage preserves their exact conditional ratios.
  // Never estimate absent labels. Discard unrelated rows and sampled text.
  return {probabilities, confidence, raw: {
    selected_native_logprobs: selected, returned_vocabulary_entries: count,
    native_vocabulary_size: vocabularySize, full_vocabulary_returned: count === vocabularySize,
    offered_label_coverage_verified: true,
    native_response_sha256: await digest(JSON.stringify(response)),
    usage: response.usage, timings: response.timings, sample_discarded: true,
    post_sampling_probs: false, label_temperature: 1,
  }};
}
