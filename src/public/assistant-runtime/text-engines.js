import {textMessages} from './text-protocol.js';

export async function createTextEngine(profile, {assetBase, onProgress = () => {}, onLog = () => {}, contextTokens = 1024, outputTokens = 256} = {}) {
  if (profile.engine !== 'litert-lm') throw Error('Unsupported text engine: ' + profile.engine);
  if (profile.projector || profile.kind === 'vision') throw Error('Text engines require a text-only profile');
  if (!Number.isInteger(contextTokens) || contextTokens < 128 || !Number.isInteger(outputTokens) || outputTokens < 1) throw Error('Invalid context/output token limits');
  let worker, bootstrapModuleUrl;
  if (profile.engine === 'transformers') worker = new Worker(new URL('./transformers-worker.js', import.meta.url), {type: 'module'});
  else {
    const pageBase = assetBase;
    bootstrapModuleUrl = new URL('gemma-worker.js', pageBase).href;
    worker = new Worker(new URL('./litert/candidate-bootstrap.js', pageBase), {type: 'classic'});
  }
  const pending = new Map(); let sequence = 0, disposed = false, busy = false, invalidated = false;
  function shutdown(error) {
    disposed = invalidated = true; worker.terminate();
    for (const task of pending.values()) {task.cleanup(); task.reject(error);}
    pending.clear();
  }
  worker.onerror = event => {event.preventDefault?.(); shutdown(Error('Text worker failed: ' + (event.message || 'unknown worker error')));};
  worker.onmessageerror = event => {event.preventDefault?.(); shutdown(Error('Text worker returned an unreadable message'));};
  worker.onmessage = ({data}) => {
    if (data.type === 'bootstrap_ready') return;
    if (data.type === 'bootstrap_error') {shutdown(Error('LiteRT worker bootstrap failed: ' + data.error.message)); return;}
    if (data.type === 'progress') {onProgress(data.progress); return;}
    if (data.type === 'log') {onLog(data.message); return;}
    const task = pending.get(data.id);
    if (!task) return;
    if (data.type === 'text') {task.onText?.(data.text); return;}
    if (data.type === 'thinking') {task.onThinking?.(data.text); return;}
    if (data.type === 'raw_text') return;
    if (data.type !== 'result' && data.type !== 'error') return;
    pending.delete(data.id); task.cleanup();
    if (data.type === 'error') {const error = Error(data.error.message); error.worker_stack = data.error.stack; task.reject(error);}
    else task.resolve(data.result);
  };
  function request(type, payload = {}, {signal, onText, onThinking, timeoutMs} = {}) {
    if (disposed) return Promise.reject(Error('Text model is unloaded; reload to continue'));
    if (signal?.aborted) return Promise.reject(Error('Generation cancelled'));
    return new Promise((resolve, reject) => {
      const id = ++sequence; let timer;
      const abort = () => shutdown(Error('Generation cancelled or timed out; model unloaded. Reload to continue.'));
      const cleanup = () => {clearTimeout(timer); signal?.removeEventListener('abort', abort);};
      pending.set(id, {resolve, reject, cleanup, onText, onThinking});
      signal?.addEventListener('abort', abort, {once: true});
      if (timeoutMs) timer = setTimeout(() => shutdown(Error(`Text model ${type === 'generate' ? 'generation' : type} timed out; model unloaded. Reload to continue.`)), timeoutMs);
      try {worker.postMessage({id, type, ...payload});}
      catch (error) {pending.delete(id); cleanup(); reject(error);}
    });
  }
  let info;
  try {
    if (bootstrapModuleUrl) worker.postMessage({type: 'bootstrap', moduleUrl: bootstrapModuleUrl});
    info = await request('load', {profile, contextTokens, outputTokens}, {timeoutMs: profile.settings?.load_timeout_ms ?? 1200000});
  }
  catch (error) {shutdown(error); throw error;}
  return {kind: profile.engine, info, get invalidated() {return invalidated;},
    reset() {if (busy) throw Error('Wait for generation before resetting');},
    async generate(messages, {maxTokens = outputTokens, tools = [], signal, onText = () => {}, onThinking = () => {}, image, enableThinking = false, temperature = 0} = {}) {
      if (busy) throw Error('One text generation at a time');
      const normalized = textMessages(messages, image);
      if (!Number.isInteger(maxTokens) || maxTokens < 1) throw Error('Output limit must be a positive integer');
      if (!Number.isFinite(temperature) || temperature < 0) throw Error('Invalid temperature');
      busy = true;
      try {return await request('generate', {messages: normalized, options: {maxTokens, tools, enableThinking, temperature}},
        {signal, onText, onThinking, timeoutMs: profile.settings?.response_timeout_ms ?? 180000});}
      finally {busy = false;}
    },
    async dispose() {
      if (disposed) return;
      if (busy) {shutdown(Error('Text model unloaded during generation')); return;}
      try {await request('dispose', {}, {timeoutMs: 10000});}
      finally {shutdown(Error('Text model unloaded'));}
    }};
}
