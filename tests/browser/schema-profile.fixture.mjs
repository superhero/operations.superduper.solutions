// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Observe RPC structure without serializing or retaining document/model payloads. */
export function observeSchemaTransfers() {
  const NativeWorker = globalThis.Worker;
  globalThis.__schemaTransfers = { replies: 0, documents: 0, headers: 0, models: 0, operations: 0, methods: {} };
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (options?.name !== 'operations-schema-library') return;
      const requests = new Map();
      const post = this.postMessage.bind(this);
      this.postMessage = (request, ...rest) => {
        if (request?.kind === 'request') requests.set(request.id, request.method);
        return post(request, ...rest);
      };
      this.addEventListener('message', ({ data }) => {
        if (data?.kind !== 'result' && data?.kind !== 'error') return;
        const method = requests.get(data.id);
        requests.delete(data.id);
        if (!method) return;
        const stats = globalThis.__schemaTransfers;
        stats.replies++;
        stats.methods[method] = (stats.methods[method] ?? 0) + 1;
        const value = data.value;
        const documents = new Set();
        for (const record of value?.records ?? []) if (record.document) documents.add(record.document);
        for (const entry of value?.catalogs ?? []) {
          if (entry.catalog?.document && Object.keys(entry.catalog.document.paths ?? {}).length) documents.add(entry.catalog.document);
          else if (entry.catalog?.document) stats.headers++;
          stats.operations += entry.operations?.length ?? 0;
          stats.models += entry.operations?.filter(operation => !operation.deferred).length ?? 0;
        }
        if (method === 'model' && value?.operation) stats.models++;
        if (method === 'models' && Array.isArray(value)) stats.models += value.length;
        if (method === 'document' && value?.paths) documents.add(value);
        stats.documents += documents.size;
      });
    }
  };
}

/** CDP's worker sessions expose the worker heap, rather than just the page heap. */
async function workers(browser, pageSession) {
  const root = await browser.newBrowserCDPSession();
  const page = (await pageSession.send('Target.getTargetInfo')).targetInfo;
  const targets = (await root.send('Target.getTargets')).targetInfos
    .filter(target => target.type === 'worker' && target.browserContextId === page.browserContextId);
  const pending = new Map();
  let nextId = 0;
  root.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
    const reply = JSON.parse(message);
    const request = pending.get(`${sessionId}:${reply.id}`);
    if (!request) return;
    pending.delete(`${sessionId}:${reply.id}`);
    clearTimeout(request.timer);
    if (reply.error) request.reject(new Error(reply.error.message)); else request.resolve(reply.result);
  });
  const attached = [];
  try {
    for (const target of targets) {
      const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
      const send = (method, params = {}) => new Promise((resolveRequest, reject) => {
        const id = ++nextId;
        const key = `${sessionId}:${id}`;
        const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Worker profile request timed out: ${method}`)); }, 15_000);
        pending.set(key, { resolve: resolveRequest, reject, timer });
        root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
          .catch(error => { clearTimeout(timer); pending.delete(key); reject(error); });
      });
      const name = (await send('Runtime.evaluate', { expression: 'globalThis.name', returnByValue: true })).result.value;
      attached.push({ name, send });
    }
    return { attached, close: () => root.detach() };
  } catch (error) { await root.detach(); throw error; }
}

export async function heapProfile(browser, context, page) {
  const session = await context.newCDPSession(page);
  const workerSessions = await workers(browser, session);
  try {
    await session.send('HeapProfiler.collectGarbage');
    const pageHeap = await session.send('Runtime.getHeapUsage');
    const workerHeaps = [];
    for (const worker of workerSessions.attached) {
      await worker.send('HeapProfiler.collectGarbage');
      workerHeaps.push({ name: worker.name, ...await worker.send('Runtime.getHeapUsage') });
    }
    return { page: pageHeap, workers: workerHeaps,
      dom: await session.send('Memory.getDOMCounters'),
      containerBytes: await readFile('/sys/fs/cgroup/memory.current', 'utf8').then(value => Number(value.trim())).catch(() => null),
      totalBackingBytes: (pageHeap.backingStorageSize ?? 0) + workerHeaps.reduce((total, worker) => total + (worker.backingStorageSize ?? 0), 0),
      totalEmbedderBytes: (pageHeap.embedderHeapUsedSize ?? 0) + workerHeaps.reduce((total, worker) => total + (worker.embedderHeapUsedSize ?? 0), 0),
      totalUsedBytes: pageHeap.usedSize + workerHeaps.reduce((total, worker) => total + worker.usedSize, 0) };
  } finally { await workerSessions.close(); await session.detach(); }
}

export async function renderProfile(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const object = (await session.send('Runtime.evaluate', { expression: 'window' })).result.objectId;
    const { listeners } = await session.send('DOMDebugger.getEventListeners', { objectId: object });
    const byType = {};
    for (const listener of listeners) byType[listener.type] = (byType[listener.type] ?? 0) + 1;
    await session.send('Runtime.releaseObject', { objectId: object });
    return { windowListeners: byType, ...await session.send('Memory.getDOMCounters') };
  } finally { await session.detach(); }
}

export async function cpuProfile(browser, context, page, action) {
  const session = await context.newCDPSession(page);
  const workerSessions = await workers(browser, session);
  const targets = [{ name: 'page', send: (method, params) => session.send(method, params) },
    ...workerSessions.attached.filter(worker => worker.name === 'operations-schema-library')];
  try {
    for (const target of targets) {
      await target.send('Profiler.enable');
      await target.send('Profiler.setSamplingInterval', { interval: 2000 });
      await target.send('Profiler.start');
    }
    const result = await action();
    const profiles = [];
    for (const target of targets) profiles.push({ name: target.name, ...(await target.send('Profiler.stop')) });
    return { result, profiles };
  } finally { await workerSessions.close(); await session.detach(); }
}

export async function saveSchemaProfile(world, report, profiles, attach = true) {
  if (attach) await world.attach(JSON.stringify(report), 'application/vnd.operations.schema-performance+json');
  const directory = process.env.SCHEMA_PROFILE_OUTPUT ?? world.artifactDirectory;
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  for (const { name, profile } of profiles) await writeFile(resolve(directory, `${name}.cpuprofile`), JSON.stringify(profile));
}

/** Count index traffic separately from query messages, without copying payloads. */
export function observeMatchingTransfers() {
  const NativeWorker = globalThis.Worker;
  globalThis.__matchingTransfers = { workers: 0, terminations: 0, requests: 0, indexOperations: 0, scores: 0, results: 0, methods: {} };
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (options?.name !== 'operation-matching') return;
      const stats = globalThis.__matchingTransfers;
      stats.workers++;
      const post = this.postMessage.bind(this), terminate = this.terminate.bind(this);
      this.terminate = () => { stats.terminations++; return terminate(); };
      this.postMessage = (request, ...rest) => {
        if (request?.kind === 'request') {
          stats.requests++;
          stats.methods[request.method] = (stats.methods[request.method] ?? 0) + 1;
          if (request.method === 'configure') stats.indexOperations += request.args[0].reduce((total, catalog) => total + catalog.prepared.length, 0);
          if (['evaluate', 'evaluatePrepared'].includes(request.method)) stats.indexOperations += request.args[1].length;
        }
        return post(request, ...rest);
      };
      this.addEventListener('message', ({ data }) => {
        if (data?.kind !== 'result' || !data.value?.candidates) return;
        stats.scores += data.value.candidates.length;
        stats.results += data.value.results.length;
      });
    }
  };
}
