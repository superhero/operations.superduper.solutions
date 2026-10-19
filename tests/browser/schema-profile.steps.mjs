// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, setMode } from './workspace.steps.mjs';
import { cpuProfile, heapProfile, observeSchemaTransfers, saveSchemaProfile, renderProfile } from './schema-profile.fixture.mjs';
import descriptors from '../../src/catalogs/services/index.json' with { type: 'json' };

async function ready(page) {
  await page.waitForFunction(() => document.getElementById('app')?.hasChildNodes()
    && !document.getElementById('app')?.hasAttribute('inert'), undefined, { timeout: 90_000 });
  const time = performance.now();
  await page.locator('#startup-status').evaluateAll(loaders => {
    for (const loader of loaders) for (const animation of loader.getAnimations()) animation.finish();
  });
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  return time;
}
async function schemas(page) {
  await setMode(page, 'settings');
  const heading = page.locator('summary[aria-label="Schemas"]');
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  const section = page.getByRole('region', { name: 'OpenAPI documents', exact: true });
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await expect(section.getByRole('alert')).toHaveCount(0);
  return section;
}
async function changeEnablement(page, enabledIds) {
  await page.evaluate(ids => new Promise((resolveRequest, reject) => {
    const request = indexedDB.open('v1/catalogs/index');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('catalog', 'readwrite');
      const store = tx.objectStore('catalog');
      const records = store.getAll();
      records.onsuccess = () => { for (const record of records.result) store.put({ ...record, enabled: ids.includes(record.id) }, record.id); };
      tx.oncomplete = () => { db.close(); resolveRequest(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), enabledIds);
}

Then('schema lifecycle performance is measured with the complete service collection', { timeout: 300_000 }, async function () {
  const page = this.page;
  // Install observation before the measured navigations. It records counts only;
  // serializing full RPC payloads would distort the thing being measured.
  await this.context.addInitScript(observeSchemaTransfers);
  await page.goto(`${this.baseURL}/vault-fixture.html`);
  await page.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) if (name.startsWith('v1/catalogs'))
      await new Promise((resolveRequest, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolveRequest();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Schema profile reset blocked: ${name}`));
      });
  });
  const started = performance.now();
  await page.goto(this.baseURL, { waitUntil: 'domcontentloaded' });
  const freshStartupMs = await ready(page) - started;
  await schemas(page);
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + 2);
  const report = { label: process.env.SCHEMA_PROFILE_LABEL ?? 'current', browser: this.browser.version(),
    sourcePacks: descriptors.length, operationCount: descriptors.reduce((total, source) => total + source.operations, 0),
    freshStartupMs, initialTransfers: await page.evaluate(() => globalThis.__schemaTransfers),
    initialHeap: await heapProfile(this.browser, this.context, page), searches: [] };
  await openCatalog(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const searchCpu = await cpuProfile(this.browser, this.context, page, async () => {
    for (const query of ['List projects', 'Create a new project', 'get']) {
      const start = performance.now();
      await prompt.fill(query);
      await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', query, { timeout: 30_000 });
      report.searches.push({ query, durationMs: performance.now() - start,
        visibleMatches: await page.locator('[data-operation-id]').count() });
      report.searches.at(-1).render = await renderProfile(this.context, page);
    }
    await prompt.fill('');
  });
  const profiles = searchCpu.profiles.map(profile => ({ ...profile, name: `search-${profile.name}` }));
  await schemas(page);
  const toggle = page.locator('[data-schema-id="frankfurter"]').getByRole('switch');
  const measured = await cpuProfile(this.browser, this.context, page, async () => {
    const durations = [];
    for (const enabled of [false, true, false, true]) {
      const start = performance.now();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
      await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toHaveAttribute('aria-busy', 'false');
      durations.push(performance.now() - start);
    }
    return durations;
  });
  report.toggleMs = measured.result;
  profiles.push(...measured.profiles);
  report.afterToggleTransfers = await page.evaluate(() => globalThis.__schemaTransfers);
  await saveSchemaProfile(this, { ...report, stage: 'before-inspection' }, profiles, false);
  const inspector = page.locator('[data-schema-id="openai"]');
  const summary = inspector.locator('.schema-disclosure > summary');
  await summary.click();
  await expect(inspector.locator('.json-view')).toBeVisible({ timeout: 30_000 });
  report.openInspectorHeap = await heapProfile(this.browser, this.context, page);
  await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect(inspector.locator('.schema-disclosure')).toHaveJSProperty('open', false);
  report.closedInspectorHeap = await heapProfile(this.browser, this.context, page);
  report.closedInspectorViews = await inspector.locator('.json-view').count();
  report.restarts = [];
  for (const [name, enabled] of [['all', descriptors.map(source => source.id).concat(['demo', 'httpbin'])],
    ['none', []], ['subset', ['demo', 'httpbin', 'frankfurter']]]) {
    await page.goto(`${this.baseURL}/vault-fixture.html`);
    await changeEnablement(page, enabled);
    const start = performance.now();
    await page.goto(this.baseURL, { waitUntil: 'domcontentloaded' });
    const startupMs = await ready(page) - start;
    await schemas(page);
    const actual = await page.locator('[data-schema-id] [role="switch"][aria-checked="true"]').count();
    assert.equal(actual, enabled.length);
    report.restarts.push({ name, enabled: enabled.length, startupMs,
      transfers: await page.evaluate(() => globalThis.__schemaTransfers),
      heap: await heapProfile(this.browser, this.context, page) });
  }
  await saveSchemaProfile(this, report, profiles);
});

Then('the largest bundled schema can be inspected without retaining its closed viewer', { timeout: 60_000 }, async function () {
  const page = this.page;
  await schemas(page);
  const largest = [...descriptors].sort((a, b) => b.bytes - a.bytes)[0];
  const card = page.locator(`[data-schema-id="${largest.id}"]`);
  const heading = card.locator('.schema-disclosure > summary');
  const rows = () => card.locator('.json-line, .json-branch > summary');
  await heading.click();
  await expect(card.locator('.json-view')).toBeVisible({ timeout: 30_000 });
  const first = await rows().count();
  assert.ok(first > 0 && first <= 1000, `Initial rendered JSON rows: ${first}`);
  await card.getByRole('button', { name: 'Load more', exact: true }).click();
  const expanded = await rows().count();
  assert.ok(expanded > first && expanded <= 2000, `Expanded rendered JSON rows: ${expanded}`);
  await heading.click();
  await expect(card.locator('.json-view')).toHaveCount(0);
  await heading.click();
  await expect(card.locator('.json-view')).toBeVisible();
  assert.equal(await rows().count(), first, 'Reopening resets the page without losing source data.');
  await heading.click();
  await expect(card.locator('.json-view')).toHaveCount(0);
  await this.attach(JSON.stringify({ schema: largest.id, sourceBytes: largest.bytes, firstRows: first, expandedRows: expanded,
    closedViews: await card.locator('.json-view').count() }), 'application/json');
});

Then('a closed schema inspector ignores a delayed source reply and can reopen', async function () {
  await this.context.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const pending = [];
    let held = true;
    globalThis.__schemaDocumentReplies = 0;
    globalThis.__schemaDocumentPending = () => pending.length;
    globalThis.__releaseSchemaDocuments = () => { held = false; for (const send of pending.splice(0)) send(); };
    Worker.prototype.postMessage = function (request, ...args) {
      if (held && request?.kind === 'request' && request.method === 'document') {
        const worker = this;
        const id = request.id;
        const reply = event => {
          if (event.data?.id !== id || !['result', 'error'].includes(event.data.kind)) return;
          globalThis.__schemaDocumentReplies++;
          worker.removeEventListener('message', reply);
        };
        worker.addEventListener('message', reply);
        pending.push(() => post.call(worker, request, ...args));
      } else return post.call(this, request, ...args);
    };
  });
  const page = this.page;
  await page.reload();
  await ready(page);
  await schemas(page);
  const card = page.locator('[data-schema-id="frankfurter"]');
  const heading = card.locator('.schema-disclosure > summary');
  await heading.click();
  await page.waitForFunction(() => globalThis.__schemaDocumentPending() === 1);
  await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => globalThis.__releaseSchemaDocuments());
  await page.waitForFunction(() => globalThis.__schemaDocumentReplies === 1);
  await expect(card.locator('.json-view')).toHaveCount(0);
  await heading.click();
  await expect(card.locator('.json-view')).toContainText('/rates');
  await expect(card.getByRole('alert')).toHaveCount(0);
  await heading.click();
  await expect(card.locator('.json-view')).toHaveCount(0);
});
