// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { After, AfterAll, Given, Then, When, Status } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const retryKey = 'v1/startup/module-reload';
const runtimeMessage = 'Startup fixture module failed';
let server;
let serverReady;

async function developmentURL() {
  serverReady ??= (async () => {
    // Shared browser fixtures build production bundles before this server starts.
    const previousNodeEnv = process.env.NODE_ENV;
    const define = { 'process.env.NODE_ENV': '"development"' };
    try {
      process.env.NODE_ENV = 'development';
      server = await createServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
        mode: 'development', define, optimizeDeps: { rolldownOptions: { transform: { define } } },
        cacheDir: resolve('tmp/test/browser', `startup-vite-${randomUUID()}`), logLevel: 'error',
        server: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
    expect(server.config.isProduction).toBe(false);
    await server.listen();
    return `http://127.0.0.1:${server.httpServer.address().port}`;
  })();
  return serverReady;
}

async function startWithFault(world, fault) {
  const url = await developmentURL();
  const state = world.startup = { fault, requests: 0, pageErrors: [], consoleErrors: [], consoleChecks: [] };
  state.context = await world.browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  await state.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await state.context.route('**/*', async route => {
    const request = route.request();
    if (!request.url().startsWith(`${url}/`)) return route.abort('blockedbyclient');
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/application.ts') {
      state.requests++;
      if (state.fault === 'runtime') return route.fulfill({ contentType: 'text/javascript',
        body: `throw new Error(${JSON.stringify(runtimeMessage)});` });
      if (state.fault === 'always' || state.fault === 'once' && state.requests === 1)
        return route.fulfill({ status: 504, contentType: 'text/plain', body: 'Outdated Optimize Dep' });
    }
    return route.continue();
  });
  state.page = await state.context.newPage();
  state.page.on('pageerror', error => state.pageErrors.push({ message: error.message, stack: error.stack }));
  state.page.on('console', message => {
    if (message.type() !== 'error' || !message.text().includes(runtimeMessage)) return;
    state.consoleChecks.push(Promise.all(message.args().map(arg => arg.evaluate(value =>
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : null)))
      .then(values => state.consoleErrors.push(...values.filter(Boolean))));
  });
  await state.page.goto(url, { waitUntil: 'commit', timeout: 90_000 });
}

async function expectReady(state) {
  await state.page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app?.hasChildNodes() && !app.hasAttribute('inert');
  }, undefined, { timeout: 90_000 });
  await expect(state.page.locator('#startup-status')).toHaveCount(0);
  expect(await state.page.evaluate(key => sessionStorage.getItem(key), retryKey)).toBeNull();
}

Given('the development application module fails once with an outdated dependency response', { timeout: 90_000 },
  async function () { await startWithFault(this, 'once'); });
Given('the development application module keeps failing with an outdated dependency response', { timeout: 90_000 },
  async function () { await startWithFault(this, 'always'); });
Given('the development application module throws a runtime error', { timeout: 90_000 },
  async function () { await startWithFault(this, 'runtime'); });

Then('the development application finishes loading after one automatic retry', { timeout: 90_000 }, async function () {
  await expectReady(this.startup);
  expect(this.startup.requests).toBe(2);
});
Then('startup offers Reload after exactly one automatic retry', { timeout: 90_000 }, async function () {
  const state = this.startup;
  await expect(state.page.locator('#startup-stage')).toHaveText('Loading failed', { timeout: 85_000 });
  await expect(state.page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  expect(await state.page.evaluate(key => sessionStorage.getItem(key), retryKey)).toBe('/');
  // Keep observing after failure: a second navigation would expose a reload loop.
  await state.page.waitForTimeout(750);
  expect(state.requests).toBe(2);
});
Then('startup shows the original runtime error without automatically reloading', { timeout: 90_000 }, async function () {
  const state = this.startup;
  await expect(state.page.locator('#startup-stage')).toHaveText('Loading failed', { timeout: 85_000 });
  await expect(state.page.locator('#startup-recovery')).toContainText(runtimeMessage);
  await Promise.all(state.consoleChecks);
  expect(state.consoleErrors).toContainEqual(expect.objectContaining({ name: 'Error', message: runtimeMessage,
    stack: expect.stringContaining('application.ts') }));
  await state.page.waitForTimeout(750);
  expect(state.requests).toBe(1);
});
When('the application module becomes available and I reload startup', async function () {
  this.startup.fault = null;
  await this.startup.page.getByRole('button', { name: 'Reload', exact: true }).click();
});
Then('the development application finishes loading with its retry guard cleared', { timeout: 90_000 },
  async function () { await expectReady(this.startup); });

After({ tags: '@startup-modules' }, async function ({ result }) {
  const state = this.startup;
  if (!state?.context) return;
  const failed = result?.status !== Status.PASSED || state.pageErrors.length > 0;
  try {
    if (failed) {
      await mkdir(this.artifactDirectory, { recursive: true });
      await this.attach(JSON.stringify({ requests: state.requests, pageErrors: state.pageErrors,
        consoleErrors: state.consoleErrors, url: state.page?.url() }), 'application/json');
      if (state.page) await this.attach(await state.page.screenshot({
        path: `${this.artifactDirectory}/startup.png`, timeout: 5_000 }), 'image/png');
    }
  } finally {
    try { await state.context.tracing.stop(failed ? { path: `${this.artifactDirectory}/startup-trace.zip` } : {}); }
    finally { await state.context.close(); }
  }
  expect(state.pageErrors, 'Unexpected development page errors').toEqual([]);
});
AfterAll(async function () { await server?.close(); });
