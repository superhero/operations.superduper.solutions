const PRECISION = Object.freeze({embed_tokens: 'fp16', vision_encoder: 'fp16', decoder_model_merged: 'q4'});

// Publisher-owned, unmodified exports. BF16 native bases exist; the requested
// browser trial explicitly uses LiquidAI's recommended mixed FP16/Q4 export.
export const VISION_MODEL_PINS = Object.freeze({
  'LiquidAI/LFM2.5-VL-1.6B-ONNX': Object.freeze({
    repo: 'LiquidAI/LFM2.5-VL-1.6B-ONNX', revision: 'd0e00ca26cc42892d9f3c4380faa631927218209',
    artifactBytes: 2339072031, dtype: PRECISION, loader: 'published-session-names',
    textArtifactBytes: 1486255735,
    chatTemplate: Object.freeze({filename: 'chat_template.jinja', bytes: 434,
      sha256: 'cf0af741b36248dfe460af825b0b3acb3c651cf7dd40a74c29447f60b75d2b9b'}),
    sessionFiles: Object.freeze({embed_tokens: 'embed_tokens', vision_encoder: 'embed_images', decoder_model_merged: 'decoder'}),
  }),
});

export function resolveVisionPin(profile) {
  const pin = VISION_MODEL_PINS[profile.model || profile.repo];
  if (!pin) throw Error('This vision adapter accepts only the two pinned official LiquidAI ONNX repositories.');
  if (profile.revision && profile.revision !== pin.revision) throw Error(`Unqualified model revision: ${profile.revision}`);
  return pin;
}

function abortError(message = 'Vision generation cancelled.') { return Object.assign(Error(message), {name: 'AbortError'}); }

export async function createVisionEngine(profile, {
  onProgress = () => {}, onLog = () => {}, contextTokens = 1024, outputTokens = 256,
  createWorker = () => new Worker(new URL('./vision-worker.js', import.meta.url), {type: 'module'}),
} = {}) {
  const pin = resolveVisionPin(profile);
  if (!Number.isInteger(contextTokens) || contextTokens < 1 || !Number.isInteger(outputTokens) || outputTokens < 1) throw Error('Context and output budgets must be positive integers.');
  const preprocessing = profile.settings?.preprocessing ?? 'native';
  if (!['native', 'letterbox-white-square-v1'].includes(preprocessing)) throw Error(`Unqualified vision preprocessing: ${preprocessing}`);
  const textOnly = profile.settings?.text_only === true || profile.input_mode === 'text' || profile.kind === 'text';
  const worker = createWorker();
  const loadTimeout = profile.settings?.load_timeout_ms ?? 20 * 60 * 1000;
  const responseTimeout = profile.settings?.response_timeout_ms ?? 180000;
  const pending = new Map();
  let sequence = 0, disposed = false, busy = false;
  const engine = {kind: profile.engine, info: null, invalidated: false};
  function settle(id, error, result) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id); clearTimeout(request.timer); clearTimeout(request.cancelTimer);
    request.signal?.removeEventListener('abort', request.abort);
    error ? request.reject(error) : request.resolve(result);
  }
  function invalidate(error) {
    engine.invalidated = true;
    worker.terminate();
    for (const id of [...pending.keys()]) settle(id, error);
  }
  worker.onmessage = ({data}) => {
    const request = pending.get(data?.id);
    if (!request) return;
    if (data.type === 'progress') onProgress(data.progress);
    else if (data.type === 'log') onLog(data.message);
    else if (data.type === 'text') { if (!request.aborted) request.onText?.(data.text); }
    else if (data.type === 'result') settle(data.id, request.aborted ? abortError() : null, data.result);
    else if (data.type === 'error') settle(data.id, Object.assign(Error(data.message || 'Vision worker failed.'), {name: data.name || 'Error'}));
  };
  worker.onerror = event => { event.preventDefault?.(); invalidate(Error(event.message || 'Vision worker failed.')); };
  worker.onmessageerror = () => invalidate(Error('The vision worker returned an unreadable message.'));
  function request(type, payload, {signal, onText, timeout = responseTimeout} = {}) {
    if (engine.invalidated) return Promise.reject(Error('Reload the vision model after its worker failed.'));
    if (signal?.aborted) return Promise.reject(abortError());
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const operation = {resolve, reject, signal, onText};
      operation.timer = setTimeout(() => invalidate(Error(`Vision ${type} timed out. Reload the model to retry.`)), timeout);
      operation.abort = () => {
        if (operation.aborted) return;
        operation.aborted = true;
        worker.postMessage({type: 'cancel', id});
        operation.cancelTimer = setTimeout(() => invalidate(abortError('Vision cancellation timed out; reload the model.')), 5000);
      };
      pending.set(id, operation);
      signal?.addEventListener('abort', operation.abort, {once: true});
      try { worker.postMessage({id, type, ...payload}); } catch (error) { invalidate(error); }
    });
  }
  try {
    engine.info = await request('load', {pin, contextTokens, outputTokens, preprocessing, textOnly}, {timeout: loadTimeout});
  } catch (error) { invalidate(error); throw error; }
  engine.generate = async (messages, {
    maxTokens = outputTokens, tools = [], signal, onText = () => {}, image, enableThinking = false, temperature = 0,
  } = {}) => {
    if (disposed) throw abortError('The vision model has been disposed.');
    if (busy) throw Error('Wait for the current vision response to finish.');
    if (tools.length) throw Error('This LiquidAI chat adapter does not execute tool calls.');
    if (textOnly && image) throw Error('This text-only profile does not accept images.');
    if (!Number.isInteger(maxTokens) || maxTokens < 1) throw Error('The output budget must be a positive integer.');
    if (temperature !== 0) throw Error('This first-pass vision trial uses deterministic greedy decoding (temperature 0).');
    if (enableThinking) throw Error('Thinking mode is not enabled for this vision trial.');
    busy = true;
    try { return await request('generate', {messages, image, maxTokens}, {signal, onText}); }
    finally { busy = false; }
  };
  engine.reset = async () => { if (busy) throw Error('Wait for the current vision response to finish.'); };
  engine.dispose = async () => {
    if (disposed) return;
    disposed = true;
    for (const id of [...pending.keys()]) settle(id, abortError('Vision model disposed.'));
    try { if (!engine.invalidated) await request('dispose', {}, {timeout: 5000}); }
    finally { worker.terminate(); worker.onmessage = worker.onerror = worker.onmessageerror = null; }
  };
  return engine;
}
