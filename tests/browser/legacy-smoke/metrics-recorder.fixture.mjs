// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { exampleCatalogState } from "../catalog-state.fixture.mjs";
// Isolated browser/IndexedDB; test clocks advance only inside this test context.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createFixtureServer, ownedBrowser, openSettings, waitForApplicationReady } from './support.mjs';

const nativeExecution = page => ({ threads: page.workers().length + 1, dedicatedWorkers: page.workers().length });
const nativeWorkerNames = page => Promise.all(page.workers().map(worker => worker.evaluate(() => globalThis.name)));

// Assertions are advanced by the named steps in legacy-smoke.feature.
export async function* journey(world, variant) {

const directory = world.artifactDirectory;
await mkdir(directory, { recursive: true });
const server = await createFixtureServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
  cacheDir: resolve(directory, '.vite'), server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
  plugins: [{ name: 'metrics-recorder-smoke-fixture',
    resolveId(id) { if (id === '/metrics-recorder-fixture.js') return '\0metrics-recorder-fixture'; },
    load(id) { if (id === '\0metrics-recorder-fixture') return `
      import LightningFS from '@isomorphic-git/lightning-fs';
      import * as git from 'isomorphic-git';
      export async function inspect() {
        const fs = new LightningFS('v1/metrics', { defer: true });
        return { commits: (await git.log({ fs, dir: '/metrics' })).length, files: await git.listFiles({ fs, dir: '/metrics' }) };
      }`; },
  }] });
const results = {}, errors = [];
const installMemoryProbe = () => {
  window.recorderProbe = { calls: 0, active: 0, maximumActive: 0, resolve: null, states: [] };
  Object.defineProperty(performance, 'memory', { configurable: true,
    value: { usedJSHeapSize: 512, totalJSHeapSize: 1024, jsHeapSizeLimit: 4096 } });
  performance.measureUserAgentSpecificMemory = () => new Promise(resolve => {
    const probe = window.recorderProbe;
    probe.calls++; probe.active++; probe.maximumActive = Math.max(probe.maximumActive, probe.active);
    probe.resolve = total => { probe.active--; probe.resolve = null; resolve({ bytes: total, breakdown: [{ bytes: total, types: ['DOM'] }] }); };
  });
};
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = ownedBrowser(world);
  let page;
  const subscribe = (target = page) => target.evaluate(async () => {
    const { subscribeMetricsRecorder } = await import('/lib/metrics-recorder.ts');
    window.recorderProbe.unsubscribe = subscribeMetricsRecorder(state => {
      window.recorderProbe.state = state;
      window.recorderProbe.states.push(state.phase);
    });
  });
  if (variant === 'lifecycle') {
  const context = await browser.newContext({ storageState: exampleCatalogState(base), viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => route.request().url().startsWith(`${base}/`) || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
  await context.addInitScript(installMemoryProbe);
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await waitForApplicationReady(page);
  await expect(page.locator('#startup-status')).toHaveCount(0);
  await subscribe();
  await expect.poll(() => page.evaluate(() => window.recorderProbe.calls)).toBe(1);
  assert.equal(await page.evaluate(() => window.recorderProbe.state.report), null);
  assert.equal(await page.getByRole('region', { name: 'Storage dashboard', exact: true }).count(), 0);
  let worker = page.workers().find(worker => worker.url().includes('metrics-recorder.worker'));
  assert.ok(worker, 'The recorder runs in a dedicated worker before Settings opens.');
  const quarter = 15 * 60_000;
  const start = Math.ceil(Date.now() / quarter) * quarter + 1000;
  await worker.evaluate(timestamp => { globalThis.probeNow = timestamp; Date.now = () => globalThis.probeNow; }, start);
  const workflow = await page.evaluate(async () => {
    const { workflowRepository } = await import('/lib/workflow-repository.ts');
    return workflowRepository.save({ version: 3, id: 'metrics-isolation', name: 'Metrics isolation', description: 'Must stay unchanged',
      nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, dashed: false, curved: true, snap: false }, null);
  });
  const catalogue = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/workflows/index');
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const database = request.result, snapshot = {};
      try {
        for (const name of database.objectStoreNames) snapshot[name] = await new Promise((resolve, reject) => {
          const tx = database.transaction(name), records = tx.objectStore(name).getAll();
          tx.oncomplete = () => resolve(records.result); tx.onerror = () => reject(tx.error);
        });
        resolve(snapshot);
      } catch (error) { reject(error); } finally { database.close(); }
    };
  }));
  const catalogueBefore = await catalogue();
  const sample = async (value, timestamp, count) => {
    await expect.poll(() => page.evaluate(() => typeof window.recorderProbe.resolve)).toBe('function');
    await worker.evaluate(timestamp => { globalThis.probeNow = timestamp; }, timestamp);
    await page.evaluate(timestamp => { window.recorderProbe.now = timestamp; Date.now = () => window.recorderProbe.now; }, timestamp);
    await page.evaluate(value => window.recorderProbe.resolve(value), value);
    await expect.poll(() => page.evaluate(() => window.recorderProbe.state.activeBar?.metrics['application.total']?.count)).toBe(count);
  };
  await sample(100, start, 1);
  const initial = await page.evaluate(() => window.recorderProbe.state);
  const execution = nativeExecution(page);
  results.workerUrls = page.workers().map(worker => worker.url());
  results.workerNames = await nativeWorkerNames(page);
  for (const name of ['operations-schema-library', 'operations-workflows', 'operations-metrics-recorder'])
    assert.ok(results.workerNames.includes(name), `The application owns its ${name} context.`);
  assert.equal(initial.report.memory.used, 512);
  assert.deepEqual(initial.report.execution, execution);
  for (const [key, value] of [['execution.threads', execution.threads], ['execution.dedicatedWorkers', execution.dedicatedWorkers]])
    assert.deepEqual(initial.activeBar.metrics[key], { open: value, high: value, low: value, close: value, count: 1 });
  assert.equal(initial.activeBar.metrics['execution.mainThread'], undefined);
  assert.equal(initial.report.repositories.items.find(item => item.id === 'metrics-isolation').metrics.head, workflow.revision);
  await openSettings(page);
  await page.locator('summary[aria-label="Browser"]').click();
  const processing = page.getByRole('region', { name: 'Processing', exact: true });
  await expect(processing.locator('dt').filter({ hasText: /^Threads$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(String(execution.threads));
  // Generate an actual long task only in this isolated browser context.
  results.longTaskDuration = await page.evaluate(() => new Promise((resolve, reject) => {
    const observer = new PerformanceObserver(list => {
      const task = list.getEntries().find(entry => entry.duration >= 75);
      if (!task) return;
      clearTimeout(timeout); observer.disconnect(); resolve(task.duration);
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('The native long task was not observed.')); }, 5000);
    observer.observe({ type: 'longtask' });
    setTimeout(() => {
      const until = performance.now() + 80;
      while (performance.now() < until) { /* Deliberate test-only main-thread task. */ }
    }, 0);
  }));
  await sample(300, start + 1000, 2);
  results.processing = await page.evaluate(() => window.recorderProbe.state.report.processing);
  assert.ok(results.processing.longTasks > 0);
  assert.ok(results.processing.blockingTime > 0);
  for (const key of ['longTasks', 'longTaskTime', 'blockingTime', 'longestTask', 'interval'])
    assert.ok(Number.isFinite(results.processing[key]) && results.processing[key] >= 0, `${key} must be a native numeric measurement.`);
  await sample(200, start + 2000, 3);
  const loadHistory = () => page.evaluate(async () => (await import('/lib/metrics-history-repository.ts')).metricsHistoryRepository.load());
yield "worker measurements retain native processing values while incomplete bars stay in memory";
  assert.deepEqual(await loadHistory(), [], 'Incomplete bars remain in memory.');
  const active = await page.evaluate(() => window.recorderProbe.state.activeBar.metrics['application.total']);
  assert.deepEqual(active, { open: 100, high: 300, low: 100, close: 200, count: 3 });
  await sample(400, start + quarter, 1);
  await expect.poll(() => page.evaluate(() => window.recorderProbe.state.bars.length)).toBe(1);
  results.saved = await loadHistory();
  assert.equal(results.saved.length, 1);
  assert.deepEqual(results.saved[0].metrics['application.total'], active);
  for (const [key, value] of [['execution.threads', execution.threads], ['execution.dedicatedWorkers', execution.dedicatedWorkers]])
    assert.deepEqual(results.saved[0].metrics[key], { open: value, high: value, low: value, close: value, count: 3 });
  for (const key of ['processing.longTasks', 'processing.blockingTime']) {
    const candle = results.saved[0].metrics[key];
    assert.ok(candle.high > 0, `${key} must persist the observed long task.`);
    assert.ok(Object.values(candle).every(Number.isFinite));
  }
  assert.equal(Object.keys(results.saved[0].metrics).some(key => /cpu|gpu/i.test(key)), false);
  results.executionSeries = await page.evaluate(async () => {
    const { metricSeries } = await import('/lib/metrics-series.ts');
    return metricSeries(window.recorderProbe.state.bars, window.recorderProbe.state.activeBar)
      .filter(series => series.key.startsWith('execution.')).map(({ key, unit }) => ({ key, unit }));
  });
  assert.deepEqual(results.executionSeries, [
    { key: 'execution.dedicatedWorkers', unit: 'count' }, { key: 'execution.threads', unit: 'count' },
  ]);
  assert.deepEqual(await catalogue(), catalogueBefore, 'Monitoring must not recover or rewrite workflow metadata.');
  results.git = await page.evaluate(async () => (await import('/metrics-recorder-fixture.js')).inspect());
  assert.equal(results.git.commits, 1);
  assert.equal(results.git.files.length, 1);
  assert.match(results.git.files[0], /^bars\/\d{4}\/\d{2}\/\d{2}\/\d{2}-\d{2}\.json$/);
  results.sequence = await page.evaluate(() => ({ calls: window.recorderProbe.calls, maximumActive: window.recorderProbe.maximumActive, states: window.recorderProbe.states }));
  assert.equal(results.sequence.maximumActive, 1, 'Page measurements must be serialized.');

yield "completed metrics bars persist exactly once without mutating workflows";
  const follower = await context.newPage(); follower.setDefaultTimeout(15000);
  follower.on('pageerror', error => errors.push(error.message));
  await follower.goto(base, { waitUntil: 'networkidle' });
  await waitForApplicationReady(follower);
  await expect(follower.locator('#startup-status')).toHaveCount(0);
  await subscribe(follower);
  await expect.poll(() => follower.evaluate(() => window.recorderProbe.state.activeBar?.metrics['application.total']?.count)).toBe(1);
  assert.equal(await follower.evaluate(() => window.recorderProbe.calls), 0, 'A second tab follows without measuring independently.');
  const followerExecution = nativeExecution(follower);
  assert.deepEqual(await follower.evaluate(async () => (await import('/lib/application-workers.ts')).applicationExecutionMetrics()),
    followerExecution, 'Each tab reports its actual dedicated workers, including the waiting follower.');
  const followerWorker = follower.workers().find(worker => worker.url().includes('metrics-recorder.worker'));
  assert.ok(followerWorker);
  await followerWorker.evaluate(timestamp => { globalThis.probeNow = timestamp; Date.now = () => globalThis.probeNow; }, start + quarter + 1000);
  await page.close(); page = follower; worker = followerWorker;
  await sample(350, start + quarter + 1000, 2);
  results.handoff = await page.evaluate(() => window.recorderProbe.state.activeBar.metrics['application.total']);
  assert.deepEqual(results.handoff, { open: 400, high: 400, low: 350, close: 350, count: 2 });
  await sample(500, start + 2 * quarter, 1);
  await expect.poll(() => page.evaluate(() => window.recorderProbe.state.bars.length)).toBe(2);
  results.saved = await loadHistory(); assert.equal(results.saved.length, 2);
  assert.deepEqual(results.saved[1].metrics['application.total'], results.handoff);
  assert.deepEqual(results.saved[1].metrics['execution.dedicatedWorkers'], { open: execution.dedicatedWorkers,
    high: Math.max(execution.dedicatedWorkers, followerExecution.dedicatedWorkers),
    low: Math.min(execution.dedicatedWorkers, followerExecution.dedicatedWorkers), close: followerExecution.dedicatedWorkers, count: 2 },
    'Worker counts describe the recording tab, not a sum across leader and follower.');
  results.gitAfterHandoff = await page.evaluate(async () => (await import('/metrics-recorder-fixture.js')).inspect());
  assert.equal(results.gitAfterHandoff.commits, 2); assert.equal(results.gitAfterHandoff.files.length, 2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('v1/metrics/cache') ?? 'null')?.bars.length)).toBe(2);
yield "one recorder owns sampling across tabs and hands over complete aggregates";
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('v1/metrics/cache')));
  assert.equal(cached.version, 1);
  assert.equal(cached.pageMemory.total, 500);
  assert.deepEqual(cached.bars, results.saved);
  const preview = structuredClone(results.saved[0]);
  preview.metrics['application.total'] = { open: 999, high: 999, low: 999, close: 999, count: 99 };
  await page.evaluate(({ cached, preview }) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    localStorage.setItem('v1/metrics/cache', JSON.stringify({ ...cached, bars: [preview] }));
  }, { cached, preview });
  // Delay delivery of real IndexedDB history only in this reload. The worker
  // still loads it normally, and its null startup snapshots reach the page.
  await page.addInitScript(timestamp => {
    Date.now = () => timestamp;
    const NativeWorker = window.Worker;
    const queued = [];
    let held = true;
    window.recorderHistoryProbe = {
      queued,
      release() { held = false; for (const deliver of queued.splice(0)) deliver(); },
    };
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (options?.name !== 'operations-metrics-recorder') return;
        Object.defineProperty(this, 'onmessage', { configurable: true, set(listener) {
          this.addEventListener('message', event => {
            const deliver = () => listener.call(this, event);
            if (held && event.data?.type === 'history') queued.push(deliver);
            else deliver();
          });
        } });
      }
    };
  }, start + 2 * quarter + 1000);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApplicationReady(page);
  await expect(page.locator('#startup-status')).toHaveCount(0);
  await subscribe();
  await expect.poll(() => page.evaluate(() => window.recorderHistoryProbe.queued.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => typeof window.recorderProbe.resolve)).toBe('function');
  const restored = await page.evaluate(() => window.recorderProbe.state);
  assert.deepEqual(restored.report, cached.report, 'Startup snapshots must preserve the cached report while measurement is pending.');
  assert.deepEqual(restored.pageMemory, cached.pageMemory);
  assert.deepEqual(restored.bars, [preview], 'The cached completed-bar preview is visible before IndexedDB history arrives.');
  assert.equal(restored.activeBar, null, 'Cached measurements never become a live aggregate.');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('v1/metrics/cache'))), { ...cached, bars: [preview] },
    'Null startup snapshots must not overwrite the valid cache.');
  await openSettings(page);
  const browserSettings = page.locator('summary[aria-label="Browser"]');
  if (await browserSettings.getAttribute('aria-expanded') !== 'true') await browserSettings.click();
  const dashboard = page.getByRole('region', { name: 'Storage dashboard', exact: true });
  const restoredProcessing = dashboard.getByRole('region', { name: 'Processing', exact: true });
  await expect(restoredProcessing).toBeVisible();
  await expect(restoredProcessing).toHaveAttribute('aria-busy', 'false');
  const memory = dashboard.getByRole('region', { name: 'Memory', exact: true });
  const memoryValue = label => memory.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
  await expect(memoryValue('Used heap')).toHaveText('512 B');
  await expect(memoryValue('Total measured')).toHaveText('500 B');
  await expect(dashboard.locator('[data-candle]')).toHaveCount(1);
  await page.evaluate(() => window.recorderHistoryProbe.release());
  await expect.poll(() => page.evaluate(() => window.recorderProbe.state.bars.length)).toBe(2);
  assert.deepEqual(await page.evaluate(() => window.recorderProbe.state.bars), results.saved,
    'IndexedDB history replaces the cached preview, including stale values.');
  await expect(dashboard.locator('[data-candle]')).toHaveCount(2);
  assert.deepEqual(await loadHistory(), results.saved);
  assert.deepEqual(await page.evaluate(async () => (await import('/metrics-recorder-fixture.js')).inspect()), results.gitAfterHandoff,
    'Restoring cached report and history must not create Git commits.');
  worker = page.workers().find(worker => worker.url().includes('metrics-recorder.worker'));
  await worker.evaluate(timestamp => { globalThis.probeNow = timestamp; Date.now = () => globalThis.probeNow; }, start + 2 * quarter + 2000);
  await sample(650, start + 2 * quarter + 2000, 1);
  assert.deepEqual(await page.evaluate(() => window.recorderProbe.state.activeBar.metrics['application.total']),
    { open: 650, high: 650, low: 650, close: 650, count: 1 }, 'Only the fresh measurement enters the live aggregate.');
  await expect(memoryValue('Total measured')).toHaveText('650 B');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('v1/metrics/cache'))?.pageMemory.total)).toBe(650);
  const refreshedCache = await page.evaluate(() => JSON.parse(localStorage.getItem('v1/metrics/cache')));
  assert.ok(refreshedCache.report.collectedAt > cached.report.collectedAt);
  assert.deepEqual(refreshedCache.bars, results.saved);
  assert.deepEqual(await loadHistory(), results.saved, 'An incomplete fresh interval does not resave cached history.');
  assert.deepEqual(await catalogue(), catalogueBefore);
  results.cacheReload = { restoredTotal: restored.pageMemory.total, freshTotal: refreshedCache.pageMemory.total,
    previewBars: restored.bars.length, authoritativeBars: refreshedCache.bars.length };
yield "cached metrics remain a preview until durable history and fresh measurements arrive";
  const lifecycleExecution = nativeExecution(page);
  const recorderCount = (await nativeWorkerNames(page)).filter(name =>
    ['operations-metrics-recorder', 'operations-error-history'].includes(name)).length;
  assert.ok(recorderCount >= 1, 'The metrics recorder owns a native execution context.');
  const registeredExecution = () => page.evaluate(async () => (await import('/lib/application-workers.ts')).applicationExecutionMetrics());
  results.executionLifecycle = [await registeredExecution()];
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  // Active recorders suspend; duplicate events must not add or leak contexts.
  const suspendedExecution = { threads: lifecycleExecution.threads - recorderCount, dedicatedWorkers: lifecycleExecution.dedicatedWorkers - recorderCount };
  await expect.poll(() => nativeExecution(page)).toEqual(suspendedExecution);
  results.executionLifecycle.push(await registeredExecution());
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
  });
  await expect.poll(() => nativeExecution(page)).toEqual(lifecycleExecution);
  await expect.poll(registeredExecution).toEqual(lifecycleExecution);
  results.executionLifecycle.push(await registeredExecution());
  assert.deepEqual(results.executionLifecycle, [
    lifecycleExecution, suspendedExecution, lifecycleExecution,
  ]);
yield "page lifecycle events maintain accurate worker accounting";
  }
  results.cacheFallbacks = [];
  for (const mode of variant === 'lifecycle' ? [] : [variant]) {
    const fallbackContext = await browser.newContext({ storageState: exampleCatalogState(base) });
    try {
      await fallbackContext.route('**/*', route => route.request().url().startsWith(`${base}/`) || /^(data|blob):/.test(route.request().url())
        ? route.continue() : route.abort());
      await fallbackContext.addInitScript(installMemoryProbe);
      await fallbackContext.addInitScript(mode => {
        const key = 'v1/metrics/cache';
        window.recorderCacheFailures = { reads: 0, writes: 0 };
        if (mode === 'corrupt') localStorage.setItem(key, '{invalid cached metrics');
        else {
          const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
          Storage.prototype.getItem = function (name) {
            if (name === key) { window.recorderCacheFailures.reads++; throw new DOMException('Cache storage blocked', 'SecurityError'); }
            return get.call(this, name);
          };
          Storage.prototype.setItem = function (name, value) {
            if (name === key) { window.recorderCacheFailures.writes++; throw new DOMException('Cache storage blocked', 'QuotaExceededError'); }
            return set.call(this, name, value);
          };
        }
      }, mode);
      const fallback = await fallbackContext.newPage();
      fallback.on('pageerror', error => errors.push(`${mode} cache: ${error.message}`));
      await fallback.goto(base, { waitUntil: 'networkidle' });
      await waitForApplicationReady(fallback);
      await expect(fallback.locator('#startup-status')).toHaveCount(0);
      await subscribe(fallback);
      await expect.poll(() => fallback.evaluate(() => typeof window.recorderProbe.resolve)).toBe('function');
      assert.equal(await fallback.evaluate(() => window.recorderProbe.state.report), null);
      await fallback.evaluate(() => window.recorderProbe.resolve(123));
      await expect.poll(() => fallback.evaluate(() => window.recorderProbe.state.pageMemory?.total)).toBe(123);
      assert.equal(await fallback.evaluate(() => window.recorderProbe.state.activeBar.metrics['application.total'].count), 1);
      if (mode === 'corrupt') {
        assert.equal(await fallback.evaluate(() => JSON.parse(localStorage.getItem('v1/metrics/cache')).pageMemory.total), 123);
      } else {
        await expect.poll(() => fallback.evaluate(() => window.recorderCacheFailures.writes)).toBeGreaterThan(0);
        assert.ok(await fallback.evaluate(() => window.recorderCacheFailures.reads > 0));
      }
      results.cacheFallbacks.push(mode);
yield "metrics collection remains usable when its optional cache is invalid or blocked";
    } finally { await fallbackContext.close(); }
  }
  assert.deepEqual(errors, []);
yield "metrics browser contexts contain no unexpected errors";

} finally {
  await writeFile(resolve(directory, 'result.json'), JSON.stringify({ ...results, errors }, null, 2));
  await browser?.close(); await server.close();
}

}
