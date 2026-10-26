import {checkedToolCalls, litertAssetBase, litertMessages, nativeTools, textMessages} from './text-protocol.js';

let runtime, engine, profile, contextTokens, outputTokens, busy = false;
const post = (id, type, fields) => self.postMessage({id, type, ...fields});
const progress = (id, status, details = {}) => post(id, 'progress', {progress: {status, ...details}});
const textOf = message => typeof message?.content === 'string' ? message.content : (message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('');

async function load(data) {
  if (engine) throw Error('Unload the current text model first');
  profile = {...data.profile, file: data.profile.file ?? data.profile.files?.[0]?.file}; contextTokens = data.contextTokens; outputTokens = data.outputTokens;
  if (!/^[a-f0-9]{40}$/.test(profile.revision ?? '') || !profile.file?.endsWith('-web.litertlm')) throw Error('A pinned browser-compatible LiteRT-LM artifact is required');
  progress(data.id, 'loading-runtime', {runtime: '@litert-lm/core', version: '0.18.0'});
  runtime = await import('@litert-lm/core');
  await runtime.loadLiteRtLm(litertAssetBase(import.meta.url));
  const url = `https://huggingface.co/${profile.model}/resolve/${profile.revision}/${profile.file}`;
  const response = await fetch(url, {credentials: 'omit', cache: 'no-store'});
  if (!response.ok || !response.body) throw Error('LiteRT model request failed: HTTP' + response.status);
  const total = Number(response.headers.get('content-length')) || profile.weight_bytes || null;
  let loaded = 0, last = 0;
  const stream = response.body.pipeThrough(new TransformStream({transform(chunk, controller) {
    loaded += chunk.byteLength;
    if (performance.now() - last > 500 || loaded === total) {last = performance.now(); progress(data.id, 'downloading', {file: profile.file, loaded, total});}
    controller.enqueue(chunk);
  }}));
  // GPU_ARTISAN consumes the stream directly; avoid a full model copy in Wasm.
  engine = await runtime.Engine.create({model: stream, backend: runtime.Backend.GPU_ARTISAN,
    mainExecutorSettings: {maxNumTokens: contextTokens}, benchmarkEnabled: true});
  progress(data.id, 'ready');
  return {engine: 'litert-lm', runtime: '@litert-lm/core', runtime_version: '0.18.0', model: profile.model,
    revision: profile.revision, file: profile.file, requested_backend: 'GPU_ARTISAN', projector: null,
    input_modalities: ['text'], context_tokens: contextTokens, thinking: false,
    template: 'publisher template embedded in pinned .litertlm', model_loading: 'streamed'};
}

async function generate(data) {
  if (!engine) throw Error('Load the text model first');
  const options = data.options, tools = nativeTools(options.tools ?? []);
  const messages = litertMessages(textMessages(data.messages));
  const maxTokens = options.maxTokens ?? outputTokens, started = performance.now();
  const conversation = await engine.createConversation({
    preface: {messages: messages.slice(0, -1), tools, extra_context: {enable_thinking: !!options.enableThinking}},
    sessionConfig: {visionModalityEnabled: false, audioModalityEnabled: false, maxOutputTokens: maxTokens,
      samplerParams: options.temperature > 0 ? {type: runtime.SamplerType.TOP_P, temperature: options.temperature, p: 0.95, k: 40} : {type: runtime.SamplerType.GREEDY}},
    enableConstrainedDecoding: tools.length > 0
  });
  let text = '', reasoning = '', firstText = null, firstThinking = null;
  const rawChunks = [], streamedCalls = [];
  try {
    for await (const chunk of conversation.sendMessageStreaming(messages.at(-1))) {
      rawChunks.push(chunk);
      const delta = textOf(chunk), thought = chunk.channels?.thought ?? '';
      if (delta) {firstText ??= performance.now() - started; text += delta; post(data.id, 'text', {text: delta});}
      if (thought) {firstThinking ??= performance.now() - started; reasoning += thought; post(data.id, 'thinking', {text: thought});}
      streamedCalls.push(...(chunk.tool_calls ?? []));
    }
    const history = await conversation.getHistory();
    const final = history.findLast(message => ['assistant', 'model'].includes(message.role));
    const checked = checkedToolCalls(final?.tool_calls ?? streamedCalls, tools);
    const benchmark = await conversation.getBenchmarkInfo();
    const completionTokens = benchmark.lastDecodeTokenCount ?? null;
    return {text: final ? textOf(final) : text, reasoning: final?.channels?.thought ?? reasoning, ...checked,
      raw_text: text, raw_chunks: rawChunks, native_message: final ?? null,
      usage: {prompt_tokens: benchmark.lastPrefillTokenCount ?? null, completion_tokens: completionTokens},
      timings: {wall_ms: performance.now() - started, first_text_ms: firstText, first_reasoning_ms: firstThinking, native: benchmark},
      finish_reason: checked.tool_calls.length ? 'tool_calls' : completionTokens !== null && completionTokens >= maxTokens ? 'length' : 'stop',
      native_settings: {enable_thinking: !!options.enableThinking, maxOutputTokens: maxTokens, context_tokens: contextTokens, constrained_tools: tools.length > 0}};
  } finally {await conversation.delete();}
}

self.onmessage = async ({data}) => {
  if (busy) {post(data.id, 'error', {error: {message: 'Text worker is busy'}}); return;}
  busy = true;
  try {
    let result;
    if (data.type === 'load') result = await load(data);
    else if (data.type === 'generate') result = await generate(data);
    else if (data.type === 'dispose') {await engine?.delete(); engine = null; result = null;}
    else throw Error('Unknown text worker command: ' + data.type);
    post(data.id, 'result', {result});
  } catch (error) {post(data.id, 'error', {error: {message: error.message, stack: error.stack}});}
  finally {busy = false;}
};
