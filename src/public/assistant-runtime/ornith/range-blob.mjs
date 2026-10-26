// Wllama's JSPI file reader calls Blob.slice(...).arrayBuffer(). Fetch those
// exact immutable bytes on demand; never cache a complete multi-GB model.
export class RangeSource {
  constructor(url, size, {signal, fetch: fetcher = globalThis.fetch, chunkBytes = 8388608, cacheBytes = 67108864, parallel = 2, onProgress = () => {}} = {}) {
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 2) throw RangeError('Use one or two parallel range requests per read');
    this.url = url; this.size = size; this.signal = signal; this.fetcher = (input, options) => fetcher.call(globalThis, input, options);
    this.chunkBytes = chunkBytes; this.cacheLimit = cacheBytes; this.parallel = parallel; this.onProgress = onProgress;
    this.cache = new Map(); this.pending = new Map(); this.cached = 0; this.received = 0; this.requests = 0;
  }
  async block(index) {
    this.signal?.throwIfAborted();
    if (this.cache.has(index)) {
      const data = this.cache.get(index); this.cache.delete(index); this.cache.set(index, data); return data;
    }
    if (this.pending.has(index)) return this.pending.get(index);
    const task = (async () => {
      const first = index * this.chunkBytes, last = Math.min(this.size, first + this.chunkBytes) - 1;
      const url = new URL(this.url); url.searchParams.set('browser_range', `${first}-${last}`);
      const timeout = AbortSignal.timeout(60000), signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
      const response = await this.fetcher(url, {headers: {Range: `bytes=${first}-${last}`}, credentials: 'omit', cache: 'no-store', signal});
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${first}-${last}/${this.size}`) {
        await response.body?.cancel(); throw Error(`Expected exact HTTP206 range for ${first}-${last}; got ${response.status}`);
      }
      const reader = response.body.getReader(), data = new Uint8Array(last - first + 1);
      let used = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read(); if (done) break;
          if (used + value.length > data.length) throw Error('Weight response exceeded requested range');
          data.set(value, used); used += value.length;
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (used !== data.length) throw Error('Truncated weight byte range');
      this.requests++; this.received += data.length;
      this.cache.set(index, data); this.cached += data.length;
      while (this.cached > this.cacheLimit && this.cache.size) {
        const key = this.cache.keys().next().value; this.cached -= this.cache.get(key).length; this.cache.delete(key);
      }
      this.onProgress({file: this.url.split('/').pop(), received_bytes: this.received, requests: this.requests, cache_bytes: this.cached, range: [first, last]});
      return data;
    })();
    this.pending.set(index, task);
    try { return await task; } finally { this.pending.delete(index); }
  }
  async read(first, end) {
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || first < 0 || end < first || end > this.size) throw RangeError('Invalid model byte range');
    this.signal?.throwIfAborted();
    const out = new Uint8Array(end - first);
    for (let offset = first; offset < end;) {
      const batch = [];
      for (let n = 0; n < this.parallel && offset < end; n++) {
        const at = offset, index = Math.floor(at / this.chunkBytes), start = index * this.chunkBytes;
        const count = Math.min(end - at, this.chunkBytes - (at - start));
        batch.push(this.block(index).then(data => out.set(data.subarray(at - start, at - start + count), at - first)));
        offset += count;
      }
      await Promise.all(batch);
    }
    return out.buffer;
  }
  clear() { this.cache.clear(); this.cached = 0; }
}

export class RangeBlob extends Blob {
  constructor(source, first = 0, end = source.size) { super([]); this.source = source; this.first = first; this.end = end; }
  get size() { return this.end - this.first; }
  get type() { return 'application/octet-stream'; }
  slice(start = 0, end = this.size) {
    const normalize = value => Math.max(0, Math.min(this.size, value < 0 ? this.size + value : value));
    const first = normalize(start), last = Math.max(first, normalize(end));
    return new RangeBlob(this.source, this.first + first, this.first + last);
  }
  arrayBuffer() { return this.source.read(this.first, this.end); }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
  stream() {
    let at = this.first; const end = this.end, source = this.source;
    return new ReadableStream({async pull(controller) {
      if (at >= end) { controller.close(); return; }
      const next = Math.min(end, at + source.chunkBytes);
      controller.enqueue(new Uint8Array(await source.read(at, next))); at = next;
    }});
  }
}
