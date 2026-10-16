// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// node tests/resize-observer.smoke.mjs — isolated server/profile, real UI actions only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { pail } from '@visulima/pail';

const directory = resolve('tmp/test/resize-observer');
await mkdir(directory, { recursive: true });
const diagnostics = [];
const measurements = [];
let browser;
let server;
let page;
let phase = 'startup';

async function settled() {
  // Reveal panels and the auto-growing sidebar prompt should settle without
  // generating native ResizeObserver loop notifications.
  await page.waitForTimeout(350);
  const state = await page.evaluate(async () => {
    const sizes = () => [...document.querySelectorAll('.reveal-panel.is-open, .catalog-prompt textarea')]
      .filter(element => element.getClientRects().length)
      .map(element => ({ id: element.id, height: element.getBoundingClientRect().height }));
    const before = sizes();
    for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame);
    return { errors: globalThis.resizeSmokeErrors, before, after: sizes() };
  });
  measurements.push({ phase, ...state });
  assert.deepEqual(state.errors, [], `${phase}: native browser errors must remain empty.`);
  assert.deepEqual(diagnostics, [], `${phase}: no secondary browser errors.`);
  assert.deepEqual(state.after.map(item => item.id), state.before.map(item => item.id), `${phase}: visible panels remain stable.`);
  state.after.forEach((item, index) => assert.ok(Math.abs(item.height - state.before[index].height) < 1,
    `${phase}: ${item.id} height must remain settled.`));
}

async function openCatalog() {
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
}

async function toggle(label, count = 4) {
  const control = page.getByRole('button', { name: label, exact: true });
  for (let index = 0; index < count; index++) {
    const expanded = await control.getAttribute('aria-expanded') === 'true';
    await control.click();
    await expect(control).toHaveAttribute('aria-expanded', String(!expanded));
    await settled();
  }
}

try {
  server = await createServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
    cacheDir: resolve(directory, '.vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  await server.listen();
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const motion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: motion });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(`${baseURL}/`) || /^(data|blob):/.test(url)) return route.continue();
      diagnostics.push({ phase, type: 'unexpected-network', url });
      return route.abort();
    });
    await context.addInitScript(() => {
      globalThis.resizeSmokeErrors = [];
      // ResizeObserver loop notifications are ErrorEvents, but Playwright's
      // pageerror alone does not capture them. Observe without canceling events
      // or wrapping ResizeObserver, so the actual browser behavior is exercised.
      window.addEventListener('error', event => {
        if (event instanceof ErrorEvent) globalThis.resizeSmokeErrors.push(event.message);
      });
    });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => diagnostics.push({ phase, type: 'pageerror', message: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') diagnostics.push({ phase, type: 'console-error', message: message.text() });
    });
    phase = `${motion}: startup`;
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 });
    await expect(page.locator('#startup-status')).toHaveCount(0);
    await settled();
    phase = `${motion}: enable evaluation details`;
    await openCatalog();
    const workspaceControls = page.getByRole('group', { name: 'Workspace', exact: true });
    await workspaceControls.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
    await settings.locator('summary[aria-label="Developer"]').click();
    const evaluationDetails = settings.getByRole('switch', { name: 'Evaluation details', exact: true });
    await expect(evaluationDetails).toHaveAttribute('aria-checked', 'false');
    await evaluationDetails.click();
    await expect(evaluationDetails).toHaveAttribute('aria-checked', 'true');
    await openCatalog();
    await workspaceControls.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Workflow canvas', exact: true })).toBeVisible();
    await settled();
    phase = `${motion}: evaluation`;
    await openCatalog();
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Get example page');
    await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'Get example page');
    await expect(page.locator('.catalog-prompt')).toHaveAttribute('aria-busy', 'false');
    await settled();
    phase = `${motion}: evaluation report`;
    await toggle('Review matching details');
    await page.setViewportSize({ width: 360, height: 720 });
    await openCatalog();
    await toggle('Review matching details', 2);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openCatalog();
    phase = `${motion}: operation`;
    await page.getByRole('button', { name: /^Add to workflow:/ }).first().click();
    await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
    const close = page.getByRole('button', { name: 'Close navigation', exact: true });
    if (await close.isVisible()) await close.click();
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await settled();
    phase = `${motion}: operation report`;
    await toggle('Review operation details', 3);
    phase = `${motion}: operation schema`;
    const schema = page.locator('summary[aria-label="OpenAPI schema"]');
    await schema.click();
    await expect(schema).toHaveAttribute('aria-expanded', 'true');
    await settled();
    await schema.getByRole('button', { name: 'Wrap lines', exact: true }).click();
    await settled();
    for (const width of [360, 480, 720, 1080, 1280]) {
      phase = `${motion}: schema viewport ${width}`;
      await page.setViewportSize({ width, height: 720 });
      await settled();
    }
    await schema.click();
    await expect(schema).toHaveAttribute('aria-expanded', 'false');
    await settled();
    await expect(page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true })).toHaveCount(0);
    await context.close();
  }
  pail.success(`ResizeObserver smoke passed (${measurements.length} settled layouts, both motion preferences).`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(directory, 'result.json'), `${JSON.stringify({ phase, diagnostics, measurements }, null, 2)}\n`);
  await browser?.close();
  await server?.close();
}
