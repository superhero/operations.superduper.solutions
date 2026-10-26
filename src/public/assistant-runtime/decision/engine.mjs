// Native decision adapter, adapted from llm-sds-01's accepted browser paths.
// This module has no dashboard, page globals, automatic runs or answer parser.
import {RangeSource, RangeBlob} from './range-blob.mjs';
import {assertInputBudget, preparedSummary, prepareStrandsInput, strandsMaxLength} from './context-guard.mjs';
import {prepareKnowLine, scoreKnowLine} from './knowline-browser.mjs';
import {prepareElephant, scoreElephant} from './elephant-browser.mjs';
import {preparePplx, scorePplx} from './pplx-browser.mjs';
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), x => x.toString(16).padStart(2, '0')).join('');
const normalize = answer => answer.type === 'noul' ? {...answer, probabilities: {true: answer.noul, false: 1 - answer.noul}, probability_derivation: 'P(false) = 1 - native noul'} : answer;
async function text(url) {const response = await fetch(url, {credentials: 'omit'}); if (!response.ok) throw Error(`Native metadata request failed (${response.status})`); return response.text();}

export async function loadDecisionEngine(profile, onProgress = () => {}) {
  const probe = profile.browser_probe, abort = new AbortController(), sources = [];
  let model, prepare, validate, score, disposed = false, busy = false;
  const progress = (phase, event = {}) => onProgress({phase, ...event});
  const dispose = async () => {
    if (disposed) return; disposed = true; abort.abort();
    try {if (model?.worker) model.worker.terminate(); else if (model) await model.exit();}
    finally {for (const source of sources) source.clear();}
  };
  try {
    if (profile.engine === 'strands-onnx') {
      const folder = probe.device === 'wasm' ? 'strands' : 'strands-native-device';
      const [{Decider}, {Tokenizer}, formatting] = await Promise.all([
        import(`./vendor/${folder}/js/decider-client.js`), import(`./vendor/${folder}/tokenizers/tokenizers.min.mjs`), import(`./vendor/${folder}/js/prompt.js`),
      ]);
      model = new Decider({weights: probe.weights_url, device: probe.device, onEvent: event => progress('loading', event)});
      const ready = await model.ready;
      if (ready.source.repo !== probe.original_model || ready.source.revision !== probe.original_revision) throw Error('Strands loaded a different native source.');
      const manifestText = await text(probe.weights_url + 'manifest.json');
      if (await digest(manifestText) !== profile.conversion_manifest_sha256) throw Error('Strands export manifest pin changed.');
      const manifest = JSON.parse(manifestText);
      if (manifest.source.repo !== ready.source.repo || manifest.source.revision !== ready.source.revision) throw Error('Strands input and native export sources differ.');
      const [tokenizerJSON, tokenizerConfig, config] = await Promise.all(['tokenizer.json', 'tokenizer_config.json', 'decider_config.json'].map(async name => {
        const source = await text(probe.weights_url + 'model/' + name), expected = manifest.files['model/' + name];
        if (!expected || new TextEncoder().encode(source).length !== expected.bytes || await digest(source) !== expected.sha256) throw Error('Strands input asset pin changed: ' + name);
        return JSON.parse(source);
      }));
      const tokenizer = new Tokenizer(tokenizerJSON, tokenizerConfig), maxLength = strandsMaxLength(config, probe.expected_max_length ?? 4096);
      prepare = request => prepareStrandsInput(request, {tokenizer, ...formatting, maxLength});
      validate = prepared => assertInputBudget(prepared, {harnessLimit: 1024, contextSize: maxLength, nativeLimit: maxLength});
      score = async (request, prepared) => {
        const raw = await model.decide(request.state, request.questions.q);
        if (raw.tokens !== prepared.rendered_tokens) throw Error('Native Strands input differs from exact preflight.');
        return {raw, answer: raw.answer};
      };
    } else {
      const family = profile.engine;
      const folder = family === 'wllama-elephant' ? 'wllama-elephant' : family === 'wllama-pplx' ? 'wllama-pplx-v3' : family === 'wllama' ? 'wllama-d3-inspect' : 'wllama';
      let formatter;
      if (family === 'wllama-knowline') formatter = await prepareKnowLine(profile, [], undefined, progress);
      else if (family === 'wllama-elephant') formatter = await prepareElephant(profile, [], undefined, progress);
      else if (family === 'wllama-pplx') formatter = await preparePplx(profile, [], undefined, progress);
      else if (family !== 'wllama') throw Error('Unknown native decision engine.');
      const {Wllama} = await import(`./vendor/${folder}/index.js`);
      model = new Wllama({default: new URL(`./vendor/${folder}/wllama.wasm`, import.meta.url).href}, {parallelDownloads: 1,
        logger: Object.fromEntries(['debug', 'log', 'warn', 'error'].map(level => [level, (...args) => progress('native', {message: args.map(String).join(' ').slice(0, 1800)})]))});
      const source = new RangeSource(`https://huggingface.co/${probe.model}/resolve/${probe.revision}/${probe.file}`, probe.weight_bytes, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(profile.settings.load_timeout_ms)]),
        chunkBytes: probe.range_chunk_bytes || 8388608, cacheBytes: probe.range_cache_bytes || 33554432, parallel: probe.range_parallel || 2,
        onProgress: value => progress('loading', value),
      });
      sources.push(source); await model.loadModel([new RangeBlob(source)], probe.load_options);
      const info = model.getLoadedContextInfo(), metadata = model.getModelMetadata().meta;
      for (const [key, expected] of Object.entries(probe.expected_context || {})) if (info[key] !== expected) throw Error('Native model dimension pin changed: ' + key);
      if (!(info.n_layer > 0 && info.n_vocab > 0 && info.n_ctx > 0)) throw Error('Native model has no usable context.');
      const budget = {harnessLimit: 1024, contextSize: info.n_ctx, batchSize: probe.load_options.n_batch, microbatchSize: probe.load_options.n_ubatch};
      if (family === 'wllama-knowline') {
        if (metadata['qwen35.attention.causal'] === 'false') throw Error('KnowLine requires causal attention.');
        prepare = formatter.prepareRequest;
        validate = prepared => assertInputBudget(prepared, {harnessLimit: 1024, contextSize: info.n_ctx, reservedTokens: 1});
        score = async (request, prepared) => {
          const result = await scoreKnowLine(model, prepared, {logprobsLimit: probe.logprobs_output_limit});
          const question = request.questions.q, probabilities = result.probabilities;
          const answer = question.type === 'noul' ? {type: 'noul', noul: probabilities.true}
            : question.type === 'choice' ? {type: 'choice', probabilities, choice: Object.keys(probabilities).reduce((a, b) => probabilities[a] >= probabilities[b] ? a : b), confidence: result.confidence}
            : {type: 'score', probabilities, score: Object.entries(probabilities).reduce((sum, [key, p]) => sum + Number(key) * p, 0),
              legend: Object.fromEntries(question.criteria.map((value, index) => [String(index), value])), confidence: result.confidence};
          return {raw: result.raw, answer};
        };
      } else if (family === 'wllama-elephant') {
        if (typeof model.createBlockReadout !== 'function') throw Error('Elephant needs its dedicated native block readout.');
        prepare = formatter.prepareRequest;
        validate = prepared => assertInputBudget(prepared, {...budget, nativeLimit: 1024, blockTokenCounts: [prepared.prefixTokens.length, prepared.suffixTokens.length]});
        score = async (request, prepared) => scoreElephant(model, {request}, prepared);
      } else if (family === 'wllama-pplx') {
        if (typeof model.createInlineReadout !== 'function') throw Error('Perplexity needs its native protocol-v3 readout.');
        prepare = formatter.prepareRequest;
        validate = prepared => assertInputBudget(prepared, {...budget, nativeLimit: 1024, minTokens: 3});
        score = async (request, prepared) => scorePplx(model, {request}, prepared);
      } else {
        if (typeof model.inspectSystemOne !== 'function' || metadata['qwen35.decision.type'] !== probe.required_decision_type || metadata['qwen35.attention.causal'] !== 'false') throw Error('D3 needs the pinned native inspector and noncausal decision protocol.');
        if (await digest(metadata['tokenizer.chat_template.systemone'] || '') !== probe.systemone_template_sha256) throw Error('D3 native prompt template pin changed.');
        for (const [kind, expected] of Object.entries(probe.required_temperatures || {})) if (Number(metadata['qwen35.decision.temperature.' + kind]) !== expected) throw Error('D3 native calibration pin changed: ' + kind);
        if (probe.runtime_protocol_version !== probe.required_protocol_version) throw Error('D3 protocol versions differ.');
        prepare = async request => {
          const inspected = await model.inspectSystemOne(request), d = inspected.diagnostics, tasks = inspected.tasks;
          if (d?.decode_calls !== 0 || d.tasks_posted !== 0 || d.no_forward !== true || d.format !== 'native-systemone' || d.text_only !== true ||
              tasks?.length !== 1 || tasks[0].question_id !== 'q' || tasks[0].variant !== 0 || !Array.isArray(tasks[0].tokens) ||
              tasks[0].input_tokens !== tasks[0].tokens.length || d.n_ctx !== info.n_ctx) throw Error('D3 inspector did not prove complete input preparation without inference.');
          return {tokens: tasks[0].tokens, rendered_tokens: tasks[0].input_tokens, native_inspection: d};
        };
        validate = prepared => assertInputBudget(prepared, {...budget, batchSize: prepared.native_inspection.n_batch, microbatchSize: prepared.native_inspection.n_ubatch});
        score = async (request, prepared) => {
          const raw = await model.createSystemOne(request);
          if (raw.usage?.input_tokens !== prepared.rendered_tokens) throw Error('D3 native token count differs from preflight.');
          return {raw, answer: raw.answers.q};
        };
      }
    }
    progress('ready');
    return {dispose,
      async decide(request) {
        if (disposed || busy) throw Error(disposed ? 'Reload the decision model.' : 'One native decision at a time.');
        busy = true; let forwarding = false;
        try {
          const prepared = await prepare(request); validate(prepared);
          forwarding = true;
          const {raw, answer} = await score(request, prepared);
          return {answers: {q: normalize(answer)}, raw, prepared: preparedSummary(prepared), profile: profile.id};
        } catch (error) {if (forwarding || error.name !== 'InputPreflightError') await dispose(); throw error;}
        finally {busy = false;}
      }};
  } catch (error) {await dispose().catch(() => {}); throw error;}
}
