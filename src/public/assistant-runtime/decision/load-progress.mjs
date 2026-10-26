// Download observation only; preserve the bytes supplied to native tokenizers.
export async function fetchTextProgress(url, {key, label, onProgress = () => {}}) {
  let loaded = 0, total = null, lastUpdate = 0;
  const report = (state, detail) => onProgress({key, label, state, loaded, total, detail});
  report('loading', 'Downloading');
  try {
    const response = await fetch(url, {credentials: 'omit'});
    if (!response.ok) throw Error(`${label}: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (!response.headers.get('content-encoding') && length > 0) total = length;
    if (!response.body) {
      const text = await response.text();
      loaded = new TextEncoder().encode(text).length; total = loaded;
      report('complete', 'Downloaded'); return text;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder(), parts = [];
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        if (total != null && loaded > total) total = null;
        parts.push(decoder.decode(value, {stream: true}));
        if (performance.now() - lastUpdate >= 100) {report('loading', 'Downloading'); lastUpdate = performance.now();}
      }
      parts.push(decoder.decode());
    } finally {reader.releaseLock();}
    total = loaded;
    report('complete', 'Downloaded');
    return parts.join('');
  } catch (error) {report('failed', 'Download failed'); throw error;}
}

// RangeSource emits fixed, nonoverlapping chunks. Count each chunk only once,
// even if it is fetched again after leaving its bounded in-memory cache.
export function rangeProgress(total) {
  const seen = new Set(); let loaded = 0;
  return event => {
    const [first, last] = event.range || [];
    const key = `${first}-${last}`;
    if (Number.isSafeInteger(first) && Number.isSafeInteger(last) && first >= 0 && last >= first && last < total && !seen.has(key)) {
      seen.add(key); loaded += last - first + 1;
    }
    return {loaded, total, detail: 'Unique file bytes read; unused ranges may be skipped'};
  };
}

export function strandsFileProgress(event) {
  if (event.type !== 'progress') return null;
  return {key: 'strands/' + event.label, label: event.label,
    state: event.got === event.total ? 'complete' : 'loading', loaded: event.got, total: event.total,
    detail: event.cached ? 'Verified browser cache' : event.got === event.total ? 'Downloaded' : 'Downloading model file'};
}
