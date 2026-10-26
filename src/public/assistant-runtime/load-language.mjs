import {executionPlans, loadWithFallback, abortableGeneration} from './execution.js';
import {samplingOptions} from './settings.js';
import {createTextEngine} from './text-engines.js';
function mergeToolDeltas(calls, deltas = []) {
  for (const delta of deltas) {
    const index = delta.index ?? 0;
    calls[index] ??= {id: '', type: 'function', function: {name: '', arguments: ''}};
    const c = calls[index];
    if (delta.id) c.id = delta.id;
    c.function.name += delta.function?.name ?? '';
    c.function.arguments += delta.function?.arguments ?? '';
  }
}


export async function loadWllama(profile, onProgress, options = {}) {
  const BrowserGGUF = options.createGGUF || (await import(new URL('ornith/engine.mjs', options.assetBase).href)).BrowserGGUF;
  const plans = executionPlans(profile, options.capabilities, options);
  const {instance: base, info} = await loadWithFallback(plans, (plan, remaining) => new BrowserGGUF({...profile,
    settings: {...profile.settings, ...plan, load_timeout_ms: remaining,
      flash_attention: plan.mode === 'cpu' ? false : profile.settings.flash_attention}}, onProgress), onProgress, profile.settings.load_timeout_ms);
  info.execution.cpu_threads = profile.settings.cpu_threads;
  info.execution.flash_attention = info.execution.mode === 'cpu' ? false : profile.settings.flash_attention;
  info.execution.placement_log = base.logs.filter(line => /offload|model buffer|compute buffer/.test(line));
  Object.assign(info, {engine: 'wllama', requested_engine: profile.engine, family: profile.family ?? (profile.engine === 'ornith' ? 'ornith' : null),
    runtime_source: JSON.parse(JSON.stringify(profile.runtime_source ?? null))});
  try {
    return {kind: 'wllama', info, invalidated: false, reset() {}, logs: () => base.logs.slice(),
      async generate(messages, {tools, signal, maxTokens, onText, onThinking = () => {}, generation = profile.settings}) {
        const calls = []; let text = '', reasoning = '', finish = null, usage, timings;
        const start = performance.now(); let first = null;
        await abortableGeneration(() => base.raw.createChatCompletion({messages: messages.map(message => ({...message, ...(message.tool_calls ? {tool_calls: message.tool_calls.map(call => ({...call, function: {...call.function, arguments: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments)}}))} : {})})), tools, tool_choice: tools.length ? 'auto' : 'none', stream: true,
          ...samplingOptions(generation, 'wllama'), max_tokens: maxTokens, cache_prompt: !!profile.settings.prefix_cache,
          chat_template_kwargs: {enable_thinking: !!profile.settings.thinking}, abortSignal: signal,
          onData(chunk) {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) { first ??= performance.now(); text += delta.content; onText(delta.content); }
            if (delta?.reasoning_content) { reasoning += delta.reasoning_content; onThinking(delta.reasoning_content); }
            mergeToolDeltas(calls, delta?.tool_calls);
            finish = chunk.choices?.[0]?.finish_reason || finish;
            usage = chunk.usage || usage; timings = chunk.timings || timings;
          }}), signal, async () => { this.invalidated = true; await base.dispose(); });
        return {message: {role: 'assistant', content: text, ...(reasoning ? {reasoning_content: reasoning} : {}), ...(calls.length ? {tool_calls: calls.filter(Boolean)} : {})},
          finish_reason: signal?.aborted ? 'cancelled' : finish,
          native_settings: {...samplingOptions(generation, 'wllama'), enable_thinking: !!profile.settings.thinking, cache_prompt: !!profile.settings.prefix_cache},
          usage: usage ?? {}, timings: {...timings, browser_first_text_ms: first === null ? null : first - start}, wall_ms: performance.now() - start};
      }, dispose: () => base.dispose()};
  } catch (error) { await base.dispose().catch(() => {}); throw error; }
}

export async function loadGemma(profile, onProgress, options = {}) {
  const settings = profile.settings;
  if (profile.projector !== null || settings.thinking || settings.prefix_cache || settings.sampling_mode !== 'greedy')
    throw Error('Gemma requires text-only GPU greedy decoding with reasoning and prefix cache off.');
  const base = await createTextEngine(profile, {assetBase: options.assetBase, onProgress,
    contextTokens: settings.context_tokens, outputTokens: settings.max_new_tokens});
  return {kind: 'litert-lm', reset: async () => base.reset(), dispose: () => base.dispose(),
    async generate(messages, {tools, signal, maxTokens, onText, onThinking}) {
      const result = await base.generate(messages, {tools, signal, maxTokens, onText, onThinking, temperature: 0, enableThinking: false});
      return {...result, message: {role: 'assistant', content: result.text || '',
        ...(result.reasoning ? {reasoning_content: result.reasoning} : {}),
        ...(result.tool_calls?.length ? {tool_calls: result.tool_calls} : {})}, usage: result.usage || {}};
    }};
}
