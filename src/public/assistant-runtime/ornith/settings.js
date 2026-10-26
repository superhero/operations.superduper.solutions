// Only these settings may change; model files, revisions and precision stay pinned.
export const loadKeys = ['context_tokens', 'context_shift', 'cpu_threads', 'batch_tokens', 'micro_batch_tokens', 'flash_attention', 'cache_type_k', 'cache_type_v', 'image_max_pixels', 'image_max_tokens', 'prefix_cache', 'thinking', 'load_timeout_ms'];
export const requestKeys = ['max_new_tokens', 'sampling_mode', 'temperature', 'top_k', 'top_p', 'min_p', 'seed', 'chat_timeout_ms', 'turn_timeout_ms', 'max_model_turns', 'max_tool_calls', 'check_max_new_tokens', 'check_timeout_ms'];
export const settingKeys = [...loadKeys, ...requestKeys];
// The historical engine names remain aliases for their original runtimes.
// Model family must not select loading, sampling or device requirements.
export const isWebML = engine => engine === 'webml' || engine === 'bonsai';
export const isWllama = engine => engine === 'wllama' || engine === 'ornith';
const wllamaOnly = ['context_shift', 'cpu_threads', 'batch_tokens', 'micro_batch_tokens', 'flash_attention', 'cache_type_k', 'cache_type_v', 'image_max_tokens'];
const supportedKeys = profile => settingKeys.filter(key => isWllama(profile.engine) || !wllamaOnly.includes(key));

export function defaultSettings(profile, overrides = {}) {
  const s = profile.settings;
  const defaults = {context_tokens: s.context_tokens, context_shift: s.context_shift ?? false, cpu_threads: s.cpu_threads ?? 4,
    batch_tokens: s.batch_tokens ?? 128, micro_batch_tokens: s.micro_batch_tokens ?? 64,
    flash_attention: s.flash_attention ?? true, cache_type_k: s.cache_type_k ?? 'f16', cache_type_v: s.cache_type_v ?? 'f16',
    image_max_pixels: s.image_max_pixels ?? 262144, image_max_tokens: s.image_max_tokens ?? 256,
    prefix_cache: s.prefix_cache ?? isWebML(profile.engine), thinking: s.thinking ?? s.enable_thinking ?? false,
    load_timeout_ms: s.load_timeout_ms ?? 1200000, max_new_tokens: s.max_new_tokens ?? 1024,
    sampling_mode: s.sampling_mode ?? (s.temperature > 0 ? 'sample' : 'greedy'), temperature: s.temperature > 0 ? s.temperature : 0.7,
    top_k: s.top_k ?? 20, top_p: s.top_p ?? 0.8, min_p: s.min_p ?? 0, seed: s.seed ?? 42,
    chat_timeout_ms: s.chat_timeout_ms ?? 600000, turn_timeout_ms: s.turn_timeout_ms ?? s.chat_timeout_ms ?? 600000,
    max_model_turns: s.max_model_turns ?? 6, max_tool_calls: s.max_tool_calls ?? 8,
    check_max_new_tokens: s.smoke_max_new_tokens ?? 256, check_timeout_ms: s.check_timeout_ms ?? 180000};
  return validateSettings(profile, {...Object.fromEntries(supportedKeys(profile).map(key => [key, defaults[key]])), ...overrides});
}

export function validateSettings(profile, input) {
  if (!isWebML(profile.engine) && !isWllama(profile.engine)) throw Error('Unknown engine: ' + profile.engine);
  const unknown = Object.keys(input).filter(key => !supportedKeys(profile).includes(key));
  if (unknown.length) throw Error('Unknown setting: ' + unknown.join(', '));
  const s = {...input};
  const number = (key, min, max, integer = false) => {
    const value = s[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
      throw Error(`${key} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
  };
  number('context_tokens', 512, 262144, true);
  if (isWllama(profile.engine)) {
    if (typeof s.context_shift !== 'boolean') throw Error('context_shift must be true or false');
    number('cpu_threads', 1, 64, true); number('batch_tokens', 1, 2048, true); number('micro_batch_tokens', 1, 2048, true);
    if (s.micro_batch_tokens > s.batch_tokens) throw Error('Micro batch must not exceed batch size');
    if (s.batch_tokens > s.context_tokens) throw Error('Batch size must not exceed context size');
    number('image_max_tokens', 64, 2048, true);
    if (typeof s.flash_attention !== 'boolean') throw Error('flash_attention must be true or false');
    for (const key of ['cache_type_k', 'cache_type_v']) if (!['f16', 'f32', 'q8_0', 'q4_0'].includes(s[key])) throw Error('Unsupported KV cache type');
  }
  number('image_max_pixels', 16384, 1048576, true);
  number('load_timeout_ms', 30000, 3600000, true); number('chat_timeout_ms', 1000, 3600000, true); number('turn_timeout_ms', 1000, 3600000, true);
  if (s.turn_timeout_ms > s.chat_timeout_ms) throw Error('Response timeout must not exceed the total request timeout');
  number('max_new_tokens', 1, 20000, true); number('temperature', 0.01, 2);
  number('top_k', isWebML(profile.engine) ? 1 : 0, isWebML(profile.engine) ? 64 : 1000, true);
  number('top_p', 0.001, 1); number('min_p', 0, 1); number('seed', 0, 4294967295, true);
  number('max_model_turns', 1, 32, true); number('max_tool_calls', 1, 64, true);
  number('check_max_new_tokens', 1, 20000, true); number('check_timeout_ms', 1000, 3600000, true);
  if (!['greedy', 'sample'].includes(s.sampling_mode)) throw Error('Choose greedy or sampled decoding');
  for (const key of ['prefix_cache', 'thinking']) if (typeof s[key] !== 'boolean') throw Error(key + ' must be true or false');
  return s;
}

export function configuredProfile(profile, settings) {
  const validated = validateSettings(profile, settings);
  return {...profile, settings: {...profile.settings, ...validated, enable_thinking: validated.thinking, decoding: validated.sampling_mode}};
}

export function samplingOptions(settings, engine) {
  if (!isWebML(engine) && !isWllama(engine)) throw Error('Unknown engine: ' + engine);
  if (isWebML(engine) && (!Number.isInteger(settings.top_k) || settings.top_k < 1 || settings.top_k > 64))
    throw Error('WebML top_k must be an integer from 1 to 64');
  const sample = settings.sampling_mode === 'sample';
  return {...(isWebML(engine) ? {do_sample: sample} : {}), temperature: sample ? settings.temperature : 0,
    top_k: settings.top_k, top_p: settings.top_p, min_p: settings.min_p, seed: settings.seed};
}

export function webmlLoadOptions(profile, onProgress) {
  const s = profile.settings;
  return {file: profile.file, revision: profile.revision, mmproj: profile.projector?.file ?? null,
    max_pixels: s.image_max_pixels, maxLength: s.context_tokens,
    cache: false, prefixSnapshotStore: null, chatTemplateArgs: {enable_thinking: !!s.thinking}, onProgress};
}
export const bonsaiLoadOptions = webmlLoadOptions;

export function wllamaLoadOptions(s) {
  return {n_gpu_layers: s.gpu_layers, n_threads: s.cpu_threads, n_ctx: s.context_tokens, ctx_shift: !!s.context_shift,
    n_batch: s.batch_tokens, n_ubatch: s.micro_batch_tokens, n_parallel: 1, flash_attn: s.flash_attention,
    cache_type_k: s.cache_type_k, cache_type_v: s.cache_type_v, mmproj_offload: s.vision_gpu_offload,
    image_min_tokens: 64, image_max_tokens: s.image_max_tokens, jinja: true, reasoning: !!s.thinking,
    default_template_kwargs: {enable_thinking: !!s.thinking}, warmup: true,
    cache_idle_slots: !!s.prefix_cache, cont_batching: false, seed: s.seed ?? 42};
}
export const ornithLoadOptions = wllamaLoadOptions;
