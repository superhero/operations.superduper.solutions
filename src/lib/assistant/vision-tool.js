// Adapted from the accepted llm-sds-01 browser assistant; see reference-sources.json.

export const VISION_TOOL_LIMITS = Object.freeze({imageBytes: 10 * 1024 * 1024, imagePixels: 16 * 1024 * 1024,
  imageSide: 8192, questionCharacters: 2000, imageIdCharacters: 128, contextTokens: 1024, outputTokens: 256});
const MODEL = 'LiquidAI/LFM2.5-VL-1.6B-ONNX';
const REVISION = 'd0e00ca26cc42892d9f3c4380faa631927218209';
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const abortError = message => Object.assign(new Error(message || 'Image inspection cancelled.'), {name: 'AbortError'});
const asError = error => error instanceof Error ? error : new Error(String(error));
const throwIfAborted = signal => { if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError(); };

async function defaultLoadVision(profile, options) {
  const {signal, assetBase} = options;
  const url = new URL('vision-engine.js', assetBase).href;
  const {createVisionEngine} = await import(/* @vite-ignore */ `${url}`);
  let worker;
  const abort = () => {
    if (!worker) return;
    // Terminating the owned worker must also settle the runtime's pending load.
    // The proven factory accepts an owned worker but has no load-signal option.
    try { worker.dispatchEvent(new ErrorEvent('error', {message: 'Vision model load cancelled.', cancelable: true})); }
    finally { worker.terminate(); }
  };
  signal.addEventListener('abort', abort, {once: true});
  try {
    throwIfAborted(signal);
    return await createVisionEngine(profile, {...options, createWorker() {
      throwIfAborted(signal);
      worker = new Worker(new URL('vision-worker.js', assetBase), {type: 'module'});
      return worker;
    }});
  } finally { signal.removeEventListener('abort', abort); }
}

function validateArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['image_id', 'question'].includes(key))) throw new Error('inspect_image accepts image_id and question only.');
  const image_id = typeof args.image_id === 'string' ? args.image_id.trim() : '';
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (!image_id || image_id.length > VISION_TOOL_LIMITS.imageIdCharacters || /[\u0000-\u001f]/.test(image_id)) throw new Error('Supply a valid local image ID.');
  if (!question || question.length > VISION_TOOL_LIMITS.questionCharacters) throw new Error('Image questions must contain 1–2000 characters.');
  return {image_id, question};
}

function validateImage(record) {
  if (!record) throw new Error('Unknown local image ID. Upload the image before inspecting it.');
  if (!MIME_TYPES.has(record.mimeType)) throw new Error('Image inspection accepts PNG, JPEG and WebP images.');
  if (typeof record.data !== 'string' || record.data.length > Math.ceil(VISION_TOOL_LIMITS.imageBytes / 3) * 4 + 4) throw new Error('Images must contain at most 10 MiB of local image bytes.');
  const data = record.data.replace(/[\r\n]/g, '');
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('The local image has invalid base64 data.');
  const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes > VISION_TOOL_LIMITS.imageBytes) throw new Error('Images must contain at most 10 MiB of local image bytes.');
  const width = record.width, height = record.height;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || width > VISION_TOOL_LIMITS.imageSide || height > VISION_TOOL_LIMITS.imageSide || width * height > VISION_TOOL_LIMITS.imagePixels) throw new Error('The image registry must provide valid dimensions up to 16 megapixels.');
  return {image: {data, mimeType: record.mimeType}, width, height, bytes};
}

/** Pi tool that swaps model allocations while its caller keeps the agent alive. */
export function createVisionTool({assetBase, profile, getImage, suspendText, resumeText, onState = () => {}, loadVision = defaultLoadVision,
  timeouts = {}}) {
  if (profile?.model !== MODEL || profile.revision !== REVISION || profile.engine !== 'transformers' || profile.kind !== 'vision' ||
      profile.settings?.preprocessing !== 'letterbox-white-square-v1' || profile.settings?.text_only === true) throw new Error('inspect_image requires the verified LFM2.5-VL 1.6B letterbox profile.');
  for (const [name, callback] of Object.entries({getImage, suspendText, resumeText, loadVision})) if (typeof callback !== 'function') throw new Error(`${name} must be a function.`);
  const limits = {validate: 5000, suspend: 30000, load: Math.min(profile.settings.load_timeout_ms || 1200000, 1200000),
    generate: Math.min(profile.settings.response_timeout_ms || 180000, 180000), release: 10000, resume: 1200000, ...timeouts};
  for (const value of Object.values(limits)) if (!Number.isInteger(value) || value < 1) throw new Error('Vision tool deadlines must be positive integer milliseconds.');
  let active = null, heldVision = null, unsafe = false, disposed = false;
  let state = {phase: 'idle', busy: false, model: profile.model, profile_id: profile.id || null,
    image_id: null, question: null, error: null, cleanup_failed: false, text_ready: true};
  const publish = change => {
    state = {...state, ...change};
    try { onState({...state}); } catch { /* Resource cleanup cannot depend on a view callback. */ }
  };
  publish({});
  async function deadline(promise, milliseconds, label, operation) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error(`${label} timed out.`), {name: 'TimeoutError'});
        operation?.controller.abort(error); reject(error);
      }, milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function releaseVision() {
    if (!heldVision) return;
    const engine = heldVision;
    publish({phase: 'releasing', status: 'Releasing the vision model…'});
    await deadline(Promise.resolve().then(() => engine.dispose()), limits.release, 'Vision cleanup');
    if (heldVision === engine) heldVision = null;
  }
  function resultFor(raw, args, image) {
    if (typeof raw?.text !== 'string' || !raw.text.trim()) throw new Error('The vision model returned no observations.');
    if (raw.text.length > 16000) throw new Error('The vision model exceeded its response size limit.');
    const observations = raw.text.trim();
    const details = {model: profile.model, revision: profile.revision, profile_id: profile.id || null,
      image_id: args.image_id, question: args.question, source: 'local-vision-model-output', observations,
      image: {width: image.width, height: image.height, mime_type: image.image.mimeType, bytes: image.bytes,
        ...(raw.image ? {image_tokens: raw.image.image_tokens, tensor_shapes: raw.image.tensor_shapes, preprocessing: raw.image.preprocessing} : {})},
      usage: raw.usage || {}, timings: raw.timings || {}, finish_reason: raw.finish_reason || null};
    return {content: [{type: 'text', text: `Local vision-model observations (model output; may contain errors).\nModel: ${profile.model}\nRevision: ${profile.revision}\nImage ID: ${args.image_id}\nQuestion: ${args.question}\n\n${observations}`}], details};
  }
  async function run(operation, args) {
    let output, failure, loading, suspended = false, loadPending = false;
    const {signal} = operation.controller;
    try {
      throwIfAborted(signal);
      publish({phase: 'validating', busy: true, error: null, cleanup_failed: false, image_id: args.image_id, question: args.question,
        status: 'Checking the local image…'});
      const image = validateImage(await deadline(Promise.resolve().then(() => getImage(args.image_id)), limits.validate, 'Local image lookup', operation));
      throwIfAborted(signal);
      publish({phase: 'suspending', text_ready: false, status: 'Releasing the text model before image inspection…'});
      await deadline(Promise.resolve().then(() => suspendText({signal, ...args})), limits.suspend, 'Text model suspension', operation);
      suspended = true;
      publish({text_ready: false});
      throwIfAborted(signal);
      publish({phase: 'loading', status: 'Loading the local vision model…'});
      loadPending = true;
      loading = Promise.resolve().then(() => loadVision(profile, {assetBase,signal,
        contextTokens: VISION_TOOL_LIMITS.contextTokens, outputTokens: VISION_TOOL_LIMITS.outputTokens,
        onProgress: progress => { if (active === operation) publish({status: progress?.message || progress?.status || 'Loading the local vision model…'}); },
      })).then(async engine => {
        loadPending = false; heldVision = engine;
        if (operation.finished) {
          // A late injected loader must release its allocations after timeout or
          // disposal. Text stays unloaded until the caller explicitly recovers.
          try { await releaseVision(); }
          finally { publish({phase: disposed ? 'disposed' : 'error', busy: false}); }
          throw abortError('The cancelled vision loader completed late.');
        }
        return engine;
      }, error => { loadPending = false; throw error; });
      const engine = await deadline(loading, limits.load, 'Vision model loading', operation);
      throwIfAborted(signal);
      if (!engine || typeof engine.generate !== 'function' || typeof engine.dispose !== 'function') throw new Error('The vision loader returned an invalid engine.');
      publish({phase: 'inspecting', status: 'Inspecting local image pixels…'});
      const raw = await deadline(Promise.resolve().then(() => engine.generate([{role: 'user', content: args.question}], {
        image: image.image, maxTokens: VISION_TOOL_LIMITS.outputTokens, tools: [], signal, enableThinking: false, temperature: 0,
      })), limits.generate, 'Image inspection', operation);
      throwIfAborted(signal);
      output = resultFor(raw, args, image);
    } catch (error) { failure = asError(error); }
    finally {
      if (loadPending) {
        // Owned-worker cancellation settles promptly; briefly drain that result
        // before deciding whether its allocation state is unknown.
        try { await deadline(loading, Math.min(limits.release, 1000), 'Vision load cancellation'); } catch {}
      }
      if (loadPending) {
        // An injected loader that ignores cancellation has unknown allocations.
        // Do not reload text while that loader could still create a vision model.
        unsafe = true;
        failure = new Error(`${failure?.message || 'Vision loading failed.'} Vision loading has not settled; the text model remains unloaded.`);
      }
      if (heldVision) {
        try { await releaseVision(); }
        catch (error) {
          unsafe = true;
          failure = new Error(`${failure ? failure.message + ' ' : ''}Vision resources could not be released; the text model was not resumed. ${asError(error).message}`);
        }
      }
      if (suspended && !unsafe) {
        publish({phase: 'resuming', status: signal.aborted ? 'Finishing image cleanup…' : 'Restoring the text model…'});
        try {
          const resumed = await deadline(Promise.resolve().then(() => resumeText({signal, ...args})), limits.resume, 'Text model restoration', operation);
          publish({text_ready: !signal.aborted && resumed !== false});
        } catch (error) { failure = new Error(`${failure ? failure.message + ' ' : ''}Text model restoration failed: ${asError(error).message}`); }
      }
      operation.externalSignal?.removeEventListener('abort', operation.abort);
      operation.finished = true;
      if (active === operation) active = null;
      const cancelled = failure?.name === 'AbortError';
      publish({phase: disposed ? 'disposed' : failure && !cancelled ? 'error' : 'idle', busy: false,
        cleanup_failed: unsafe, cancelled, error: failure && !cancelled ? failure.message : null,
        status: disposed ? 'Vision tool disposed.' : failure ? failure.message : 'Image inspection complete; text model restored.'});
    }
    if (failure) throw failure;
    return output;
  }
  const tool = {name: 'inspect_image', label: 'Inspect local image',
    description: 'Ask the local vision model a targeted question about an uploaded image ID. Returns model observations, literal text and uncertain details. The image remains local.',
    parameters: {type: 'object', properties: {
      image_id: {type: 'string', minLength: 1, maxLength: VISION_TOOL_LIMITS.imageIdCharacters, description: 'ID of an image already stored in this browser.'},
      question: {type: 'string', minLength: 1, maxLength: VISION_TOOL_LIMITS.questionCharacters, description: 'A targeted question about the local image.'},
    }, required: ['image_id', 'question'], additionalProperties: false},
    execute(_toolCallId, values, externalSignal) {
      if (disposed) return Promise.reject(new Error('The vision tool has been disposed.'));
      if (unsafe) return Promise.reject(new Error('Vision cleanup is incomplete. Reload before inspecting another image.'));
      if (active) return Promise.reject(new Error('Another image inspection is already running.'));
      let args;
      try { args = validateArguments(values); } catch (error) { return Promise.reject(error); }
      const operation = {controller: new AbortController(), externalSignal};
      operation.abort = () => operation.controller.abort(abortError());
      externalSignal?.addEventListener('abort', operation.abort, {once: true});
      if (externalSignal?.aborted) operation.abort();
      active = operation;
      operation.promise = run(operation, args);
      operation.done = operation.promise.catch(() => {});
      return operation.promise;
    }};
  return {tool, get state() { return {...state}; },
    async cancel(message) {
      const operation = active;
      if (operation) { operation.controller.abort(abortError(message)); await operation.done; }
    },
    async dispose() {
      disposed = true;
      const operation = active;
      if (operation) { operation.controller.abort(abortError('Vision tool disposed.')); await operation.done; }
      if (heldVision) await releaseVision();
      publish({phase: 'disposed', busy: false, status: 'Vision tool disposed.', cleanup_failed: unsafe});
    }};
}
