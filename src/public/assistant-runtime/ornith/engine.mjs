// Pi collection variant; preserves the original GS/GT GPU-only loader.
import {Wllama} from './upstream/index.js';
import {RangeSource, RangeBlob} from './range-blob.mjs';
import {ornithLoadOptions} from './settings.js';

export class BrowserGGUF {
  constructor(manifest, onProgress = () => {}) {
    this.manifest = manifest; this.onProgress = onProgress; this.logs = []; this.sources = []; this.abort = new AbortController();
    const logger = Object.fromEntries(['debug', 'log', 'warn', 'error'].map(level => [level, (...args) => {
      const line = args.map(v => typeof v === 'string' ? v : v && typeof v === 'object' ? `[${Object.keys(v).join(',')}]` : String(v)).join(' ').slice(0, 1500);
      this.logs.push(line); if (this.logs.length > 2500) this.logs.shift();
      if (/offload|buffer size|WebGPU|backend|loading model|load_tensors/.test(line)) this.onProgress({message: line});
    }]));
    this.raw = new Wllama({default: new URL('./upstream/wllama.wasm', import.meta.url).href}, {logger, parallelDownloads: 1});
  }
  async load() {
    if (!WebAssembly.Suspending || !crossOriginIsolated) throw Error('This streaming loader needs Chromium JSPI and cross-origin isolation');
    const s = this.manifest.settings;
    if (s.gpu_layers > 0) {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter?.features.has('shader-f16')) throw Error('Selected GPU mode needs shader-f16. Choose Auto or CPU and inspect Browser compatibility.');
    }
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.manifest.settings.load_timeout_ms)]);
    const blobs = [this.manifest, this.manifest.projector].filter(Boolean).map(file => {
      const source = new RangeSource(`https://huggingface.co/${this.manifest.model}/resolve/${this.manifest.revision}/${file.file}`, file.weight_bytes ?? file.bytes, {
        signal, chunkBytes: s.range_chunk_bytes, cacheBytes: s.range_lru_bytes_per_file,
        parallel: s.range_parallel, onProgress: event => this.onProgress({message: 'Streaming official GGUF ranges', ...event})
      });
      this.sources.push(source); return new RangeBlob(source);
    });
    await this.raw.loadModel(blobs, ornithLoadOptions(s));
    const info = this.raw.getLoadedContextInfo();
    if (!(info.n_layer > 0 && info.n_vocab > 0 && info.n_ctx > 0) || (this.manifest.projector && !info.has_image_input)) {
      const reason = this.logs.filter(line => /error|unable to allocate|failed|unsupported|not supported|cannot|requires/i.test(line)).slice(-12).join('\n');
      throw Error(reason || 'The runtime did not create a usable language and vision context');
    }
    const context = Object.fromEntries(['n_layer', 'n_ctx', 'n_vocab', 'n_embd', 'has_image_input', 'has_audio_input'].map(key => [key, info[key]]));
    return {context, logs: this.logs, range_downloads: this.sources.map(s => ({url: s.url, received_bytes: s.received, requests: s.requests, cache_bytes: s.cached}))};
  }
  async run(messages, {signal, max_tokens = 256, onText = () => {}} = {}) {
    const start = performance.now(); let first = null, text = '', final = null, timings = null, usage = null, finishReason = null;
    await this.raw.createChatCompletion({messages, stream: true, temperature: 0, max_tokens, seed: 42,
      cache_prompt: false, chat_template_kwargs: {enable_thinking: false}, abortSignal: signal,
      onData(chunk) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) { first ??= performance.now(); text += delta; onText(text); }
        if (chunk.timings) timings = chunk.timings;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.usage || chunk.choices?.[0]?.finish_reason) final = chunk;
      }});
    return {text, wall_ms: performance.now() - start, ttft_ms: first === null ? null : first - start, native_final: final, timings, usage, finish_reason: finishReason};
  }
  cancel() { this.abort.abort(); }
  async dispose() { this.cancel(); try { await this.raw.exit(); } finally { for (const source of this.sources) source.clear(); } }
}
