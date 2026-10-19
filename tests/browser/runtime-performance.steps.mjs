// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog } from './workspace.steps.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { cpuProfile, heapProfile, renderProfile, observeMatchingTransfers, observeSearchPhases } from './schema-profile.fixture.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const directory = world => resolve(process.env.SCHEMA_PROFILE_OUTPUT ?? world.artifactDirectory);
async function save(world, name, report, profiles = []) {
  await mkdir(directory(world), { recursive: true });
  await writeFile(resolve(directory(world), `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  for (const { name: target, profile } of profiles)
    await writeFile(resolve(directory(world), `${name}-${target}.cpuprofile`), JSON.stringify(profile));
  await world.attach(JSON.stringify(report), 'application/vnd.operations.schema-performance+json');
}
async function ready(page) {
  await page.waitForFunction(() => document.getElementById('app')?.hasChildNodes()
    && !document.getElementById('app')?.hasAttribute('inert'), undefined, { timeout: 60_000 });
  const time = performance.now();
  await page.locator('#startup-status').evaluateAll(loaders => {
    for (const loader of loaders) for (const animation of loader.getAnimations()) animation.finish();
  });
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  return time;
}

/** A bounded diagnostic trace, separate from the primary latency samples. */
async function renderTrace(context, page, path, action) {
  const session = await context.newCDPSession(page);
  let stream, recording = false, timer;
  const completed = new Promise((resolveTrace, reject) => {
    session.once('Tracing.tracingComplete', resolveTrace);
    timer = setTimeout(() => reject(new Error('The rendering trace did not complete.')), 30_000);
  });
  void completed.catch(() => {});
  try {
    await session.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: {
      includedCategories: ['devtools.timeline', 'blink.user_timing'], recordMode: 'recordUntilFull', traceBufferSizeInKb: 16384,
    } });
    recording = true;
    await page.evaluate(() => performance.mark('catalog-render-start'));
    await action();
    await page.evaluate(() => performance.mark('catalog-render-end'));
    await session.send('Tracing.end'); recording = false;
    const result = await completed;
    stream = result.stream;
    assert.notEqual(result.dataLossOccurred, true);
    assert.ok(stream, 'The rendering trace must provide a complete stream.');
    const file = await open(path, 'w');
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await session.send('IO.read', { handle: stream, size: 256 * 1024 });
        const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
        bytes += buffer.byteLength;
        assert.ok(bytes <= 32 * 1024 * 1024, 'The focused rendering trace exceeded its 32 MiB bound.');
        await file.write(buffer);
        if (chunk.eof) break;
      }
    } finally { await file.close(); }
    const trace = JSON.parse(await readFile(path, 'utf8'));
    for (const name of ['catalog-render-start', 'catalog-render-end'])
      assert.ok(trace.traceEvents.some(event => event.name === name), `Missing rendering trace boundary: ${name}`);
    const totals = {};
    for (const event of trace.traceEvents) if (['UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint'].includes(event.name) && event.ph === 'X') {
      const key = `${event.pid}:${event.tid}:${event.name}`;
      const entry = totals[key] ??= { pid: event.pid, tid: event.tid, name: event.name, count: 0, durationMs: 0 };
      entry.count++; entry.durationMs += (event.dur ?? 0) / 1000;
    }
    return { bytes, totals: Object.values(totals) };
  } finally {
    try {
      if (recording) { await session.send('Tracing.end').catch(() => {}); await completed.catch(() => {}); }
    } finally {
      clearTimeout(timer);
      if (stream) await session.send('IO.close', { handle: stream }).catch(() => {});
      await session.detach();
    }
  }
}

Then('repeated menu searches retain their output and record rendering costs', { timeout: 120_000 }, async function () {
  const page = this.page;
  await this.context.addInitScript(observeMatchingTransfers);
  await this.context.addInitScript(observeSearchPhases);
  await page.reload(); await ready(page); await openCatalog(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  async function query(value) {
    await prompt.fill(value);
    await page.waitForFunction(value => globalThis.__searchPhases.at(-1)?.query === value
      && globalThis.__searchPhases.at(-1)?.frameAt, value, { timeout: 30_000 });
    return page.evaluate(() => structuredClone(globalThis.__searchPhases.at(-1)));
  }
  const report = { label: process.env.SCHEMA_PROFILE_LABEL ?? 'current', browser: this.browser.version(),
    snapshots: process.env.SCHEMA_PROFILE_LOW_OVERHEAD !== '1', httpCache: 'disabled by routing', searches: [] };
  const queries = ['List projects', 'Create a new project', 'get'];
  const expected = new Map();
  for (const text of queries) {
    await query(text);
    expected.set(text, hash(await page.locator('[data-operation-id]').evaluateAll(rows => rows.map(row => row.dataset.operationId))));
  }
  const session = await this.context.newCDPSession(page);
  const cumulative = new Set(['RecalcStyleDuration', 'LayoutDuration', 'ScriptDuration', 'TaskDuration', 'RecalcStyleCount', 'LayoutCount']);
  try {
    await session.send('Performance.enable');
    for (let sample = 0; sample < 3; sample++) for (const text of queries) {
      const before = new Map((await session.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
      const phase = await query(text);
      const after = (await session.send('Performance.getMetrics')).metrics;
      const metrics = Object.fromEntries(after.filter(item => cumulative.has(item.name) && before.has(item.name))
        .map(item => [item.name, item.value - before.get(item.name)]));
      const ids = await page.locator('[data-operation-id]').evaluateAll(rows => rows.map(row => row.dataset.operationId));
      assert.equal(hash(ids), expected.get(text), 'Repeated searches must preserve every rendered result and its order.');
      report.searches.push({ sample, query: text, phase, metrics, matches: ids.length, signature: hash(ids), render: await renderProfile(this.context, page) });
    }
  } finally { await session.send('Performance.disable'); await session.detach(); }
  // Primary timing is finished before collecting CPU and rendering diagnostics.
  await query('List projects');
  report.heap = await heapProfile(this.browser, this.context, page);
  const diagnostic = await cpuProfile(this.browser, this.context, page, () => query('Create a new project'));
  await mkdir(directory(this), { recursive: true });
  report.trace = await renderTrace(this.context, page, resolve(directory(this), 'menu-render.trace.json'), () => query('List projects'));
  await save(this, 'menu', report, diagnostic.profiles);
});

/** Count actual RPCs and accounted model bytes, without serializing their payload. */
function observeModelRequests() {
  const NativeWorker = globalThis.Worker;
  globalThis.__modelRequests = [];
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (options?.name !== 'operations-schema-library') return;
      const pending = new Map(), post = this.postMessage.bind(this);
      this.postMessage = (message, ...rest) => {
        if (message?.kind === 'request' && message.method === 'models') {
          const request = { schema: message.args[0], ids: message.args[2], startAt: performance.now() };
          pending.set(message.id, request); globalThis.__modelRequests.push(request);
        }
        return post(message, ...rest);
      };
      this.addEventListener('message', ({ data }) => {
        const request = pending.get(data?.id);
        if (!request || !['result', 'error'].includes(data.kind)) return;
        request.endAt = performance.now(); request.failed = data.kind === 'error';
        request.models = data.value?.length ?? 0;
        request.accountedBytes = data.value?.reduce((total, model) => total + model.bytes, 0) ?? 0;
        pending.delete(data.id);
      });
    }
  };
}

Then('a ninety-six-operation workflow restores with bounded canonical models', { timeout: 180_000 }, async function () {
  const selected = [];
  for (const id of ['openai', 'cloudflare']) {
    const index = JSON.parse(gunzipSync(await readFile(`src/catalogs/services/indexes/${id}.json.gz`)));
    const operations = index.operations.filter(operation => !operation.unavailableReason);
    for (let position = 0; position < 48; position++) selected.push(operations[Math.floor(position * (operations.length - 1) / 47)]);
  }
  const document = { version: 3, id: 'runtime-large', name: 'Runtime large workflow', nodes: selected.map((operation, index) => ({
    id: `operation-${index}`, type: 'operation', position: { x: index % 4 * 360, y: Math.floor(index / 4) * 240 },
    data: { operationId: operation.id, name: operation.name, description: '', method: operation.method, path: operation.path },
  })), edges: [], viewport: { x: 0, y: 0, zoom: 0.5 }, snap: true, curved: true, dashed: true };
  assert.equal(new Set(selected.map(operation => operation.id)).size, 96);
  const page = this.page;
  await this.context.addInitScript(observeModelRequests);
  await repository(page, 'save', document, null);
  const report = { label: process.env.SCHEMA_PROFILE_LABEL ?? 'current', browser: this.browser.version(),
    snapshots: process.env.SCHEMA_PROFILE_LOW_OVERHEAD !== '1', httpCache: 'disabled by routing',
    operations: selected.map(operation => operation.id), workflowSignature: hash(document), restores: [] };
  function verify(requests) {
    assert.equal(requests.length, 6);
    assert.ok(requests.every(request => request.ids.length <= 16 && request.models === request.ids.length && !request.failed));
    assert.deepEqual(requests.flatMap(request => request.ids).sort(), selected.map(operation => operation.id).sort());
  }
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const startupMs = await ready(page) - started;
    await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(96);
    await expect(page.locator('.workflow-error')).toHaveCount(0);
    const requests = await page.evaluate(() => globalThis.__modelRequests);
    verify(requests);
    report.restores.push({ startupMs, requests, render: await renderProfile(this.context, page) });
  }
  // Heap is sampled before profilers; diagnostic import uses a fresh page with
  // no active model leases, then requests the same canonical operation set.
  report.heap = await heapProfile(this.browser, this.context, page);
  await repository(page, 'save', { ...document, id: 'runtime-empty', name: 'Runtime empty workflow', nodes: [] }, null);
  await page.reload(); await ready(page);
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(0);
  const diagnostic = await cpuProfile(this.browser, this.context, page, async () => {
    await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
    await page.waitForFunction(() => globalThis.__modelRequests.length === 6 && globalThis.__modelRequests.every(request => request.endAt));
    await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(96);
    await expect(page.locator('.workflow-error')).toHaveCount(0);
    return page.evaluate(() => globalThis.__modelRequests);
  });
  verify(diagnostic.result);
  report.diagnosticRequests = diagnostic.result;
  await save(this, 'workflow', report, diagnostic.profiles);
});
