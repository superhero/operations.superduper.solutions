// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run with matching Playwright Chromium: node tests/startup-progress.smoke.mjs
// Uses temporary browser contexts and its own local Vite server.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { pail } from '@visulima/pail';

const artifactDirectory = resolve('tmp/test/startup-progress');
await mkdir(artifactDirectory, { recursive: true });
const server = await createServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
  cacheDir: resolve(artifactDirectory, '.vite'),
  server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
const stages = ['Loading application', 'Opening settings storage', 'Reading settings', 'Applying settings', 'Loading schemas',
  'Rendering interface', 'Opening workflow storage', 'Opening workflow files', 'Finding saved workflows',
  'Checking saved workflows', 'Reading workflows', 'Loading latest workflow', 'Restoring canvas']
  .map((label, index) => `${label} — ${index + 1} of 13`);
const progressText = stages.map(stage => stage.replace(/^(.*) — (\d+ of 13)$/, '$2\n$1'));
const failureMessage = 'Startup smoke: workflow storage unavailable.';
const comment = 'Saved canvas restored before startup completes.';
const cases = [];
const diagnostics = [];
let browser;
let page;
let succeeded = false;

// Inject faults into the worker's served module, without application test hooks.
function installWorkflowStorageFault({ fault, failureMessage }) {
  const open = IDBFactory.prototype.open;
  const requests = [];
  let stalled = true;
  IDBFactory.prototype.open = function (name) {
    if (name === 'v1/workflows/index' && fault === 'workflow-failure') throw new Error(failureMessage);
    const request = open.apply(this, arguments);
    if (name === 'v1/workflows/index' && stalled) {
      const pending = { request, arrived: false };
      requests.push(pending);
      request.addEventListener('success', event => { pending.arrived = true; if (stalled) event.stopImmediatePropagation(); }, true);
    }
    return request;
  };
  globalThis.releaseStartupStorage = () => {
    stalled = false;
    for (const { request, arrived } of requests) if (arrived) request.dispatchEvent(new Event('success'));
  };
}

async function released(page) {
  await expect(page.locator('#startup-status')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('#app')).not.toHaveAttribute('inert');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
}

function ready(result) {
  assert.equal(result.console.filter(message => message.text.includes('Ready — 13 of 13')).length, 1,
    'Successful startup must log readiness once.');
}

async function showWorkflows(page) {
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
}

try {
  await server.listen();
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  async function openCase(name, fault) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (fault?.startsWith('workflow-') && new URL(url).pathname.endsWith('/workflow-repository.worker.ts')) {
        const response = await route.fetch();
        return route.fulfill({ response, body: `${installWorkflowStorageFault.toString()}\ninstallWorkflowStorageFault(${JSON.stringify({ fault, failureMessage })});\n${await response.text()}` });
      }
      if (url.startsWith(`${baseURL}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      diagnostics.push({ name, type: 'unexpected-network', url });
      return route.abort();
    });
    await context.addInitScript(({ fault, failureMessage }) => {
      // The flow renderer is lazy, but restored state must reach the workspace
      // DOM before startup finishes, even while the Operations tab is active.
      new MutationObserver(records => {
        if (globalThis.startupRemoval) return;
        if (!records.some(record => [...record.removedNodes].some(node => node.id === 'startup-status'))) return;
        const app = document.querySelector('#app');
        globalThis.startupRemoval = { inert: app.inert, busy: app.getAttribute('aria-busy'),
          populated: app.querySelector('.workflow-workspace')?.classList.contains('populated') ?? false };
      }).observe(document, { childList: true, subtree: true });
      if (fault !== 'settings-stall') return;
      const databaseName = 'v1/settings';
      const open = IDBFactory.prototype.open;
      const requests = [];
      let stalled = true;
      IDBFactory.prototype.open = function (name) {
        const request = open.apply(this, arguments);
        if (name === databaseName && stalled) {
          const pending = { request, arrived: false };
          requests.push(pending);
          request.addEventListener('success', event => { pending.arrived = true; if (stalled) event.stopImmediatePropagation(); }, true);
        }
        return request;
      };
      globalThis.releaseStartupStorage = () => {
        stalled = false;
        for (const { request, arrived } of requests) if (arrived) request.dispatchEvent(new Event('success'));
      };
    }, { fault, failureMessage });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const result = { name, stages: [], console: [], errors: [] };
    const nativeErrors = [];
    page.on('pageerror', error => diagnostics.push({ name, type: 'pageerror', message: error.message }));
    page.on('console', message => {
      const text = message.text();
      if (text.includes('startup')) result.console.push({ type: message.type(), text });
      const stage = stages.find(stage => text.includes(stage));
      if (stage) {
        if (!text.includes('startup')) diagnostics.push({ name, type: 'missing-startup-scope', message: text });
        result.stages.push(stage);
      }
      if (message.type() !== 'error') return;
      if (fault === 'workflow-failure' && text.includes(failureMessage)) {
        nativeErrors.push(message.args()[0].evaluate(error => ({ native: error instanceof Error,
          name: error?.name, message: error?.message, stack: error?.stack?.includes('workflow-repository.worker.ts') })));
      } else diagnostics.push({ name, type: 'console-error', message: text });
    });
    cases.push(result);
    return { context, page, result, nativeErrors };
  }

  const blank = await openCase('blank');
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await released(page);
  assert.deepEqual(blank.result.stages, stages, 'Blank storage must report every real stage once, in order.');
  ready(blank.result);
  blank.result.removal = await page.evaluate(() => globalThis.startupRemoval);
  assert.equal(blank.result.removal.inert, false);
  blank.result.workerHistory = await page.evaluate(async comment => {
    const { workflowRepository } = await import('/lib/workflow-repository-client.ts');
    let changes = 0;
    const unsubscribe = workflowRepository.subscribe(() => changes++);
    const first = await workflowRepository.save({ version: 3, id: 'startup-smoke', name: 'Startup smoke workflow', description: '',
      nodes: [{ id: 'startup-comment', type: 'comment', position: { x: 150, y: 120 }, data: { text: comment } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false }, null);
    const second = await workflowRepository.save({ ...first.document, description: 'Edited through the background worker.' }, first.revision);
    const earlier = await workflowRepository.readVersion(first.document.id, first.revision);
    const undone = await workflowRepository.undo(first.document.id, second.revision);
    const redone = await workflowRepository.redo(first.document.id, undone.revision);
    const history = await workflowRepository.history(first.document.id);
    await workflowRepository.list();
    unsubscribe();
    return { changes, historyCount: history.length, earlierDescription: earlier.description,
      undoneDescription: undone.document.description, redoneDescription: redone.document.description,
      restoredRevision: redone.revision === second.revision };
  }, comment);
  assert.deepEqual(blank.result.workerHistory, { changes: 4, historyCount: 2, earlierDescription: '', undoneDescription: '',
    redoneDescription: 'Edited through the background worker.', restoredRevision: true },
  'The worker must preserve saved history, undo/redo, historical reads and one notification per change.');
  assert.deepEqual(blank.result.stages, stages, 'Repository work after readiness must not repeat startup logs.');
  await page.close();
  // A fresh page shares only this test's saved IndexedDB, never a user profile.
  page = await blank.context.newPage();
  const saved = { name: 'saved', stages: [], console: [] };
  cases.push(saved);
  page.on('console', message => {
    if (message.text().includes('startup')) saved.console.push({ type: message.type(), text: message.text() });
    const stage = stages.find(stage => message.text().includes(stage));
    if (stage) saved.stages.push(stage);
    if (message.type() === 'error') diagnostics.push({ name: saved.name, type: 'console-error', message: message.text() });
  });
  page.on('pageerror', error => diagnostics.push({ name: saved.name, type: 'pageerror', message: error.message }));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await released(page);
  assert.deepEqual(saved.stages, stages, 'Saved startup must report the same ordered stages.');
  ready(saved);
  saved.removal = await page.evaluate(() => globalThis.startupRemoval);
  assert.equal(saved.removal.populated, true, 'Saved nodes must reach the workspace DOM before the loader is removed.');
  await showWorkflows(page);
  await expect(page.getByRole('button', { name: 'Edit comment text', exact: true })).toHaveText(comment);
  await page.screenshot({ path: `${artifactDirectory}/saved-ready.png` });
  await blank.context.close();

  for (const [fault, index] of [['settings-stall', 1], ['workflow-stall', 6]]) {
    const current = await openCase(fault, fault);
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    const status = page.getByRole('status', { name: 'Loading Operations', exact: true });
    await expect(status).toBeVisible();
    await expect(status.locator('#startup-progress')).toHaveText(progressText[index]);
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true');
    assert.deepEqual(current.result.stages, stages.slice(0, index + 1), 'Progress must stop at the pending storage operation.');
    await page.screenshot({ path: `${artifactDirectory}/${fault}.png` });
    if (fault === 'workflow-stall') {
      const worker = page.workers().find(worker => worker.url().includes('/workflow-repository.worker.ts'));
      assert.ok(worker, 'Workflow storage must run in its dedicated worker.');
      await worker.evaluate(() => globalThis.releaseStartupStorage());
    } else await page.evaluate(() => globalThis.releaseStartupStorage());
    await released(page);
    assert.deepEqual(current.result.stages, stages);
    ready(current.result);
    await current.context.close();
  }

  const failure = await openCase('workflow-failure', 'workflow-failure');
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await released(page);
  const overlay = page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(failureMessage);
  await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
  await showWorkflows(page);
  await expect(page.getByRole('alert').filter({ hasText: failureMessage }).first()).toBeVisible();
  assert.deepEqual(failure.result.stages, stages.slice(0, 7), 'A failed operation must not claim later stages completed.');
  assert.ok(failure.result.console.every(message => !message.text.includes('Ready —')));
  await expect.poll(() => failure.nativeErrors.length).toBe(1);
  failure.result.errors = await Promise.all(failure.nativeErrors);
  assert.deepEqual(failure.result.errors, [{ native: true, name: 'Error', message: failureMessage, stack: true }],
    'Startup must log one native error, retaining the worker failure name, message and stack.');
  await failure.context.close();

  const held = await openCase('preview-hold');
  await page.goto(`${baseURL}/?dev-loading=1`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('status', { name: 'Loading Operations', exact: true })).toBeVisible();
  await expect(page.locator('#startup-progress')).toHaveText(progressText[0]);
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true');
  assert.deepEqual(held.result.stages, stages.slice(0, 1), 'The intentional preview hold must not simulate progress.');
  await held.context.close();

  assert.deepEqual(diagnostics, [], 'Startup must not produce unexpected browser errors.');
  succeeded = true;
  pail.force.success('Startup progress smoke passed: ordered stages, saved canvas, real storage stalls, native failure, and preview hold.');
} finally {
  if (!succeeded && page && !page.isClosed()) await page.screenshot({ path: `${artifactDirectory}/failure.png` }).catch(() => {});
  await writeFile(`${artifactDirectory}/result.json`, `${JSON.stringify({ succeeded, cases, diagnostics }, null, 2)}\n`);
  await browser?.close();
  await server.close();
}
