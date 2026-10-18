// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createFixtureServer, ownedBrowser } from './support.mjs';

// Assertions are advanced by the named steps in legacy-smoke.feature.
export async function* journey(world, variant) {

const directory = world.artifactDirectory;
await mkdir(directory, { recursive: true });
const fixturePath = resolve(directory, 'runtime-source.ts');
await writeFile(fixturePath, 'export function makeRuntimeError() {\n  return new TypeError("Test-only native runtime failure.");\n}\n');
const fixtureURL = `/@fs${fixturePath}`;
const diagnostics = [];
const frames = [];
const results = [];
let browser;
let page;
let server;

try {
  server = await createFixtureServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
    cacheDir: resolve(directory, '.vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  await server.listen();
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = ownedBrowser(world);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(`${baseURL}/`) || /^(data|blob):/.test(url)) return route.continue();
    diagnostics.push({ type: 'unexpected-network', url });
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', error => diagnostics.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.push({ type: 'console-error', message: message.text() });
  });
  page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
    try {
      const frame = JSON.parse(String(payload));
      if (frame.event === 'visulima:vite-overlay:error') frames.push(frame.data);
    } catch { /* Ignore non-JSON websocket control frames. */ }
  }));
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 });
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  await expect(page.locator('#startup-status')).toHaveCount(0);
  const overlay = page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true });
  await expect(overlay).toHaveCount(0);

  for (const kind of [variant]) {
    const before = frames.length;
    const historyBefore = await page.evaluate(() => globalThis.__v_o_error_history?.length ?? 0);
    const captured = await page.evaluate(async ({ kind, fixtureURL }) => {
      let value;
      let event;
      if (kind === 'native') {
        value = (await import(fixtureURL)).makeRuntimeError();
        event = new ErrorEvent('error', { error: value, message: value.message, cancelable: true });
      } else if (kind === 'resize-observer') {
        value = null;
        event = new ErrorEvent('error', {
          message: 'ResizeObserver loop completed with undelivered notifications.', cancelable: true
        });
      } else if (kind === 'message-source') {
        value = null;
        event = new ErrorEvent('error', { message: 'Test-only message with source location.',
          filename: `${location.origin}${fixtureURL}`, lineno: 2, colno: 10, cancelable: true });
      } else {
        value = kind === 'zero' ? 0 : kind === 'string' ? 'Test-only primitive rejection.' : {
          message: 'Test-only circular rejection.', operation: 'save-workflow', status: 409
        };
        if (kind === 'circular') value.self = value;
        event = new PromiseRejectionEvent('unhandledrejection', {
          reason: value, promise: Promise.resolve(), cancelable: true
        });
      }
      const originalValue = event instanceof ErrorEvent ? event.error : event.reason;
      const originalStack = originalValue instanceof Error ? originalValue.stack : undefined;
      const dispatched = window.dispatchEvent(event);
      const error = event instanceof ErrorEvent ? event.error : event.reason;
      return { dispatched, canceled: event.defaultPrevented, native: error instanceof Error,
        identity: error === originalValue, originalValue: error?.originalValue === originalValue,
        message: error?.message, name: error?.name, stack: error?.stack, originalStack,
        location: event instanceof ErrorEvent ? { filename: event.filename, lineno: event.lineno, colno: event.colno } : null };
    }, { kind, fixtureURL });
    assert.equal(captured.dispatched, true, `${kind}: normalization must not cancel native reporting.`);
    assert.equal(captured.canceled, false);
    assert.equal(captured.native, true, `${kind}: Visulima must receive an Error.`);
    if (kind === 'native') {
      assert.equal(captured.identity, true, 'An existing Error must retain its identity.');
      assert.equal(captured.stack, captured.originalStack, 'An existing Error must retain its original stack.');
      assert.match(captured.stack, /runtime-source\.ts:\d+:\d+/);
    } else {
      assert.equal(captured.originalValue, true, `${kind}: preserve the original rejected or missing value.`);
      if (kind !== 'message-source') assert.ok(!captured.stack?.trim() || captured.stack === captured.name,
        `${kind}: a sourceless event must not receive an invented capture stack.`);
    }
    if (kind === 'resize-observer') {
      assert.equal(captured.name, 'ResizeObserverError');
      assert.ok(captured.message.startsWith('ResizeObserver loop completed with undelivered notifications.'));
    }
    if (kind === 'zero') assert.match(captured.message, /\b0\b/);
    if (kind === 'string') assert.ok(captured.message.includes('Test-only primitive rejection.'));
    if (kind === 'circular') {
      for (const detail of ['Test-only circular rejection.', 'save-workflow', '409'])
        assert.ok(captured.message.includes(detail), `Circular rejection must retain ${detail}.`);
      assert.match(captured.message, /circular/i);
    }
    await expect.poll(() => frames.length).toBe(before + 1);
    assert.equal(frames[before].message, captured.message, 'The original reporting transport must receive all normalized details.');
    if (kind === 'message-source') {
      assert.equal(frames[before].file, `${baseURL}${fixtureURL}`);
      assert.equal(frames[before].line, 2);
      assert.equal(frames[before].column, 10);
    }
yield "the runtime event retains its original details in exactly one transport report";
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('#__v_o__message')).toHaveText(captured.message);
    await expect(overlay).not.toContainText('(unknown runtime error)');
    const payload = await overlay.evaluate(element => element.getRootNode().host.__v_oPayload);
    const error = payload.errors[0];
    const reportedStack = error.originalStack || error.stack || payload.originalStack || payload.stack || '';
    if (kind === 'native') {
      assert.match(reportedStack, /runtime-source\.ts:\d+:\d+/);
      await expect(overlay.locator('#__v_o__filelink')).toContainText('runtime-source.ts');
      await expect(overlay.locator('.shiki').first()).toContainText('new TypeError');
    } else if (kind !== 'message-source') {
      assert.ok(!/\n\s*at /.test(reportedStack), 'The overlay must not invent stack frames for sourceless events.');
      assert.doesNotMatch(reportedStack, /runtime-error\.ts|error-chain\.ts|sendError/);
      assert.ok(!error.originalFilePath, 'Sourceless events must not turn message prose into a file path.');
      const stack = overlay.locator('#__v_o__stacktrace');
      if (await stack.getAttribute('open') === null) await stack.locator(':scope > summary').click();
      await expect(stack.locator(':scope > div')).toHaveText('Stack trace is empty.');
    }
    // The plugin may resolve source frames asynchronously; allow a complete turn
    // beyond its debounce to catch duplicate reports and error-reporting cascades.
    await page.waitForTimeout(750);
    assert.equal(frames.length, before + 1, `${kind}: exactly one transport report per event.`);
    assert.equal(await page.evaluate(() => globalThis.__v_o_error_history?.length ?? 0), historyBefore + 1,
      `${kind}: exactly one history entry per event.`);
    assert.deepEqual(diagnostics, [], `${kind}: handling must not create secondary browser errors.`);
yield "the error overlay shows the normalized diagnostic without invented frames or duplicate history";
    results.push({ kind, captured, reportedStack });
    await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
    await expect(overlay).toBeHidden();
  }

} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(directory, 'results.json'), `${JSON.stringify({ results, diagnostics, frames }, null, 2)}\n`);
  await browser?.close();
  await server?.close();
}

}
