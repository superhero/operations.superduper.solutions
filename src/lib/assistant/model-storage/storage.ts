// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { openDB, type DBSchema } from 'idb';
import { createSHA256 } from 'hash-wasm';
import { createModelEvents } from './events.ts';
import { artifactsFor, profileById } from './catalog.ts';
import type { Artifact, Progress } from './catalog.ts';
export const BLOCK_BYTES = 8 * 1024 * 1024;
interface ModelDB extends DBSchema {
  artifacts: { key: string; value: { sha256: string; bytes: number } };
  blocks: { key: [string, number]; value: ArrayBuffer };
  models: { key: string; value: { id: string; hashes: string[]; installedAt: number } };
}
export const modelDatabase = () => openDB<ModelDB>('operations-ai-models-v1', 1, { upgrade(db) {
  db.createObjectStore('artifacts', { keyPath: 'sha256' }); db.createObjectStore('blocks');
  db.createObjectStore('models', { keyPath: 'id' });
} });
const events = createModelEvents();
export const subscribeModels = events.subscribe;
async function locked<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!globalThis.navigator?.locks) throw new Error('Browser model storage requires Web Locks in a secure page.');
  return navigator.locks.request('operations-ai-model-install-v1', signal ? { signal } : {}, run);
}
export async function installedModels(): Promise<string[]> {
  const db = await modelDatabase();
  try {
    const artifacts = new Map((await db.getAll('artifacts')).map(item => [item.sha256, item.bytes]));
    return (await db.getAll('models')).filter(item => {
    try { return artifactsFor(profileById(item.id)).every(file => item.hashes.includes(file.sha256) && artifacts.get(file.sha256) === file.bytes); } catch { return false; }
  }).map(item => item.id); } finally { db.close(); }
}

/** Logical use survives physical GPU handoffs. Other tabs may share the same
 * immutable files; removal requires the exclusive counterpart of this lock. */
export async function acquireModelUse(id: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  profileById(id);
  if (!globalThis.navigator?.locks) throw new Error('Browser model storage requires Web Locks in a secure page.');
  signal?.throwIfAborted();
  let release!: () => void, acquired!: () => void, failed!: (error: unknown) => void;
  const held = new Promise<void>(resolve => release = resolve);
  const granted = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  const completed = navigator.locks.request(`operations-ai-model-use-v1:${id}`, {mode: 'shared', ...(signal ? {signal} : {})}, async () => { acquired(); await held; });
  void completed.catch(failed);
  await granted;
  return async () => { release(); await completed; };
}
async function clearArtifact(hash: string): Promise<void> {
  const db = await modelDatabase();
  try {
    const tx = db.transaction(['artifacts', 'blocks'], 'readwrite');
    await tx.objectStore('artifacts').delete(hash);
    await tx.objectStore('blocks').delete(IDBKeyRange.bound([hash, 0], [hash, Number.MAX_SAFE_INTEGER]));
    await tx.done;
  } finally { db.close(); }
}
class RetryableDownload extends Error {}
async function downloadBlock(url: URL, file: Artifact, offset: number, last: number, expected: number,
  progress: (received: number) => void, signal: AbortSignal, fetcher: typeof fetch): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        ...(file.kind === 'weights' && !file.parts ? { headers: { Range: `bytes=${offset}-${last}` } } : {}) });
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel(); throw new RetryableDownload(`Download interrupted (HTTP ${response.status}).`);
      }
      if (!response.body || (file.kind === 'weights' && !file.parts ? response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${last}/${file.bytes}` : !response.ok)) {
        await response.body?.cancel(); throw new Error(`Could not download the pinned ${file.id}${file.kind === 'weights' ? ' byte range' : ''}.`);
      }
      const reader = response.body.getReader(), bytes = new Uint8Array(expected); let used = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          if (used + value.length > expected) throw new Error('Model download exceeded the pinned file size.');
          bytes.set(value, used); used += value.length; progress(offset + used);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (used !== expected) throw new Error('Model download ended before all pinned bytes arrived.');
      signal.throwIfAborted(); return bytes;
    } catch (error) {
      signal.throwIfAborted();
      const retryable = error instanceof RetryableDownload || error instanceof TypeError || error instanceof DOMException && ['NetworkError','TimeoutError'].includes(error.name);
      if (!retryable || attempt >= 2) throw error;
      progress(offset);
      await new Promise<void>((resolve, reject) => {
        const done = () => { signal.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, 250 * (attempt + 1));
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
}
/** A complete marker is written only after every byte and its digest match. */
export async function installArtifact(file: Artifact, progress: (received: number) => void, signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch): Promise<void> {
  signal.throwIfAborted();
  const db = await modelDatabase();
  try {
    const present = await db.get('artifacts', file.sha256);
    if (present?.bytes === file.bytes) { progress(file.bytes); return; }
    await clearArtifact(file.sha256);
    const digest = await createSHA256(); digest.init();
    let offset = 0;
    while (offset < file.bytes) {
      signal.throwIfAborted();
      const part = file.parts?.find((_, index) => file.parts!.slice(0, index).reduce((sum, item) => sum + item.bytes, 0) === offset);
      const last = Math.min(offset + BLOCK_BYTES, file.bytes) - 1;
      const url = new URL(part?.url ?? file.url, globalThis.location?.href ?? 'http://localhost/');
      if (file.kind === 'weights' && !file.parts) url.searchParams.set('browser_range', `${offset}-${last}`);
      const expected = part?.bytes ?? (file.kind === 'weights' ? last - offset + 1 : file.bytes);
      const bytes = await downloadBlock(url, file, offset, last, expected, progress, signal, fetcher), used = bytes.length;
      // A failed attempt must never contribute bytes twice to the whole-file hash.
      digest.update(bytes);
      signal.throwIfAborted();
      // Small runtime files also use this store; runtime size is bounded by its pin.
      for (let at = 0; at < used; at += BLOCK_BYTES)
        await db.put('blocks', bytes.slice(at, Math.min(at + BLOCK_BYTES, used)).buffer, [file.sha256, (offset + at) / BLOCK_BYTES]);
      offset += used;
    }
    if (digest.digest('hex') !== file.sha256) throw new Error(`Checksum mismatch for ${file.id}. The download was discarded.`);
    signal.throwIfAborted();
    await db.put('artifacts', { sha256: file.sha256, bytes: file.bytes });
  } catch (error) { await clearArtifact(file.sha256); throw error; }
  finally { db.close(); }
}
export async function installModel(id: string, progress: (event: Progress) => void, signal: AbortSignal, baseURL = globalThis.location?.href,
  fetcher: typeof fetch = globalThis.fetch): Promise<void> {
  const profile = profileById(id), files = artifactsFor(profile).map(file => ({ ...file, url: new URL(file.url, baseURL).href,
    ...(file.parts ? { parts: file.parts.map(part => ({ ...part, url: new URL(part.url, baseURL).href })) } : {}) }));
  await locked(async () => {
    signal.throwIfAborted();
    const db = await modelDatabase();
    try {
      // Privacy protections can mask quota estimates. Actual writes determine capacity.
      const total = files.reduce((sum, file) => sum + file.bytes, 0); let received = 0;
      for (const file of files) {
        await installArtifact(file, bytes => progress({ message: `Saving and verifying ${file.id}`, received: received + bytes, total }), signal, fetcher);
        received += file.bytes;
      }
      signal.throwIfAborted();
      await db.put('models', { id, hashes: files.map(file => file.sha256), installedAt: Date.now() });
      events.publish();
    } catch (error) {
      const retained = new Set((await db.getAll('models')).flatMap(item => item.hashes));
      for (const file of files) if (!retained.has(file.sha256)) await clearArtifact(file.sha256);
      if (error instanceof DOMException && error.name === 'QuotaExceededError')
        throw new Error('The browser ran out of storage while saving this model. Remove an unused model and try again.', { cause: error });
      throw error;
    } finally { db.close(); }
  }, signal);
}
export async function removeModel(id: string, signal?: AbortSignal): Promise<void> {
  profileById(id);
  await locked(async () => {
    await navigator.locks.request(`operations-ai-model-use-v1:${id}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Unload this model in this or another tab before removing it.');
    const db = await modelDatabase();
    try {
      await db.delete('models', id);
      const retained = new Set((await db.getAll('models')).flatMap(item => item.hashes));
      for (const file of artifactsFor(profileById(id))) if (!retained.has(file.sha256)) await clearArtifact(file.sha256);
      events.publish();
    } finally { db.close(); }
    });
  }, signal);
}
export async function readArtifact(file: Artifact, start = 0, end = file.bytes): Promise<ArrayBuffer> {
  // llama.cpp may request a complete tensor larger than 128 MiB. Preserve its
  // slice contract; installation and individual stored blocks remain bounded.
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > file.bytes)
    throw new Error('Invalid local model range.');
  const db = await modelDatabase();
  try {
    const marker = await db.get('artifacts', file.sha256);
    if (marker?.bytes !== file.bytes) throw new Error('Install this browser model before loading it.');
    const out = new Uint8Array(end - start);
    for (let offset = start; offset < end;) {
      const index = Math.floor(offset / BLOCK_BYTES), at = offset % BLOCK_BYTES;
      const block = await db.get('blocks', [file.sha256, index]);
      if (!block) throw new Error('Installed model data is missing. Remove and reinstall this model.');
      const count = Math.min(end - offset, block.byteLength - at);
      if (count <= 0) throw new Error('Installed model data is truncated. Reinstall this model.');
      out.set(new Uint8Array(block, at, count), offset - start); offset += count;
    }
    return out.buffer;
  } finally { db.close(); }
}
/** Native loaders see an HTTP-shaped local reader, without a network fallback. */
export function installedFetch(files: Artifact[]): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    const method = init?.method ?? request?.method ?? 'GET';
    if (!['GET', 'HEAD'].includes(method)) throw new Error('Unsupported local model request.');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const rangeHeader = new Headers(init?.headers ?? request?.headers).get('range');
    const queryRange = url.searchParams.get('browser_range');
    if (queryRange !== null && rangeHeader === `bytes=${queryRange}` && [...url.searchParams.keys()].length === 1) url.search = '';
    const file = files.find(item => item.url === url.href);
    // Transformers probes optional metadata. A local404 permits its documented
    // defaults; it must never become a publisher request or hide missing blocks.
    if (!file) return new Response(null, {status: 404});
    const headers = { 'content-length': String(file.bytes), 'accept-ranges': 'bytes', etag: `"${file.sha256}"` };
    const range = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) + 1 : file.bytes;
    if (rangeHeader && !range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > file.bytes || end <= start)
      return new Response(null, { status: 416, headers: {'content-range': `bytes */${file.bytes}`} });
    if (method === 'HEAD') { await readArtifact(file, 0, 0); return new Response(null, {headers}); }
    let offset = start;
    const body = new ReadableStream<Uint8Array>({ async pull(controller) {
      try {
        signal?.throwIfAborted();
        if (offset >= end) { controller.close(); return; }
        const next = Math.min(end, offset + BLOCK_BYTES);
        controller.enqueue(new Uint8Array(await readArtifact(file, offset, next))); offset = next;
      } catch (error) { controller.error(error); }
    } });
    return new Response(body, { status: range ? 206 : 200, headers: { ...headers, 'content-length': String(end - start),
      ...(range ? { 'content-range': `bytes ${start}-${end - 1}/${file.bytes}` } : {}) } });
  };
}
