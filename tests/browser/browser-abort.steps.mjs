// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { installBrowserAbortGuard, browserAbortCapture, finishBrowserContext } from '../gherkin/browser-abort-guard.mjs';

async function prepareProbe(world, stalled) {
  const context = await world.browser.newContext({ viewport: { width: 400, height: 200 } });
  const probe = world.abortProbe = { context, closed: false };
  context.on('close', () => { probe.closed = true; });
  const page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.setContent('<!doctype html><h1>Browser abort diagnostic control</h1>');
  const originalStop = context.tracing.stop.bind(context.tracing);
  let stopCalls = 0, resumeCapture;
  const deferred = new Promise(done => { resumeCapture = done; });
  const owned = stalled ? new Proxy(context, {
    get(target, key) {
      if (key === 'tracing') return { stop: async () => { stopCalls++; await deferred; } };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) : new Proxy(context, {
    get(target, key) {
      if (key === 'tracing') return { stop: async options => { stopCalls++; await originalStop(options); } };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const controller = new AbortController();
  const probeWorld = { signal: controller.signal, context: owned, page,
    config: { stepAbortGrace: 2000 }, _quickpicklePendingWork: new Set(),
    artifactDirectory: resolve(world.artifactDirectory, 'abort-probe') };
  installBrowserAbortGuard(probeWorld, { captureBudget: stalled ? 150 : 750 });
  Object.assign(probe, { page, owned, controller, world: probeWorld, stalled,
    stopCalls: () => stopCalls, resumeCapture });
}

Given('an isolated browser page records an abort diagnostic trace', async function () {
  await prepareProbe(this, false);
});
Given('an isolated browser page has an unresponsive trace capture', async function () {
  await prepareProbe(this, true);
});
When('its pending operation is aborted with its original timeout', async function () {
  const probe = this.abortProbe;
  let settled = false;
  const pending = probe.page.locator('[data-never-present]').waitFor({ state: 'visible', timeout: 0 })
    .then(() => { throw new Error('The deliberately absent element became visible'); }, error => { probe.operationError = error; })
    .finally(() => { settled = true; });
  // Confirm the browser is responsive while its locator still waits.
  await probe.page.evaluate(() => document.querySelector('h1').textContent);
  assert.equal(settled, false);
  probe.timeout = new Error('EXPECTED_BROWSER_OPERATION_TIMEOUT');
  probe.timeout.name = 'TimeoutError';
  const started = Date.now();
  probe.controller.abort(probe.timeout);
  assert.ok(probe.world._quickpicklePendingWork.size > 0, 'The runner must own abort cleanup while it is pending');
  await probe.world.browserAbortWork;
  await pending;
  probe.elapsed = Date.now() - started;
  probe.capture = await browserAbortCapture(probe.world, probe.owned);
  // Exercise the same final cleanup used by normal and startup After hooks.
  // It must reuse confirmed abort disposal without a second tracing.stop().
  await finishBrowserContext(probe.world, probe.owned, { path: probe.capture.tracePath });
});
Then('the operation settles and its owned context closes without changing the timeout', function () {
  const probe = this.abortProbe;
  assert.equal(probe.controller.signal.reason, probe.timeout);
  assert.equal(probe.controller.signal.reason.name, 'TimeoutError');
  assert.match(probe.operationError?.message ?? '', /closed/i);
  assert.equal(probe.closed, true);
  assert.equal(probe.capture.closed, true);
  assert.equal(probe.capture.closeError, undefined);
  assert.equal(probe.world._quickpicklePendingWork.size, 0);
  assert.equal(probe.stopCalls(), 1, 'Abort cleanup must not stop the same trace twice');
  assert.ok(probe.elapsed < 2000, `Abort cleanup exceeded the pending-work drain: ${probe.elapsed}ms`);
});
Then('its completed trace and screenshot remain available after cleanup', async function () {
  const capture = this.abortProbe.capture;
  assert.equal(capture.traceSaved, true, JSON.stringify(capture.issues));
  assert.equal(capture.screenshotSaved, true, JSON.stringify(capture.issues));
  assert.deepEqual(capture.issues, []);
  const trace = await readFile(capture.tracePath);
  assert.equal(trace.readUInt32LE(0), 0x04034b50);
  assert.ok(trace.includes(Buffer.from('trace.trace')), 'The ZIP must contain a recorded Playwright trace');
  const screenshot = await readFile(capture.screenshotPath);
  assert.deepEqual(screenshot.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await this.attach(screenshot, 'image/png');
  await this._quickpickleContext.annotate('Aborted operation trace', { path: capture.tracePath, contentType: 'application/zip' });
});
Then('the capture deadline records the missing trace without advertising late artifacts', async function () {
  const probe = this.abortProbe;
  assert.equal(probe.capture.traceSaved, false);
  assert.ok(probe.capture.issues.some(message => /Abort diagnostics exceeded 150ms/.test(message)));
  const before = { traceSaved: probe.capture.traceSaved, screenshotSaved: probe.capture.screenshotSaved,
    issues: [...probe.capture.issues] };
  probe.resumeCapture();
  await new Promise(done => setImmediate(done));
  assert.deepEqual({ traceSaved: probe.capture.traceSaved, screenshotSaved: probe.capture.screenshotSaved,
    issues: probe.capture.issues }, before, 'Late capture completion changed already finalized evidence');
  assert.equal(probe.stopCalls(), 1);
});

After({ tags: '@browser-abort-diagnostics' }, async function () {
  const probe = this.abortProbe;
  if (!probe) return;
  probe.world?.browserAbortCleanup?.();
  probe.resumeCapture?.();
  await probe.world?.browserAbortWork;
  await probe.context.close();
});
