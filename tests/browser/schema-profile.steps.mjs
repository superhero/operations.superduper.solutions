// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog, setMode } from './workspace.steps.mjs';
import { expandSchemaCard } from './schema-card.fixture.mjs';
import { cpuProfile, heapProfile, observeSchemaTransfers, saveSchemaProfile, renderProfile, observeMatchingTransfers, observeSearchPhases, compareBrowserMatching } from './schema-profile.fixture.mjs';
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
  await this.context.addInitScript(observeMatchingTransfers);
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
  await prompt.fill('get');
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'get');
  const searchCpu = await cpuProfile(this.browser, this.context, page, async () => {
    for (const query of ['List projects', 'Create a new project', 'get']) {
      const start = performance.now();
      await prompt.fill(query);
      await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', query, { timeout: 30_000 });
      report.searches.push({ query, durationMs: performance.now() - start,
        visibleMatches: await page.locator('[data-operation-id]').count() });
      report.searches.at(-1).render = await renderProfile(this.context, page);
      report.searches.at(-1).transfers = await page.evaluate(() => globalThis.__matchingTransfers);
    }
  });
  await prompt.fill('');
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
  await expandSchemaCard(inspector);
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
  await expandSchemaCard(card);
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
  await expandSchemaCard(card);
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


Then('startup and search phases are measured separately from diagnostic profiling', { timeout: 240_000 }, async function () {
  assert.equal(this.browser.browserType().name(), 'chromium');
  const page = this.page;
  await this.context.addInitScript(observeMatchingTransfers);
  await this.context.addInitScript(observeSearchPhases);
  const report = { label: process.env.SCHEMA_PROFILE_LABEL ?? 'current', browser: this.browser.version(),
    snapshots: process.env.SCHEMA_PROFILE_LOW_OVERHEAD !== '1', httpCache: 'disabled by routing',
    startup: [], searches: [] };
  for (let sample = 0; sample < 3; sample++) {
    await page.goto(`${this.baseURL}/vault-fixture.html`);
    await page.evaluate(async () => {
      for (const { name } of await indexedDB.databases()) if (name.startsWith('v1/catalogs'))
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve;
          request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Schema database still open'));
        });
    });
    let start = performance.now();
    await page.goto(this.baseURL, { waitUntil: 'domcontentloaded' });
    const freshMs = await ready(page) - start;
    start = performance.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persistedMs = await ready(page) - start;
    report.startup.push({ freshMs, persistedMs });
  }
  if (process.env.SCHEMA_PROFILE_STARTUP_ONLY === '1') {
    await saveSchemaProfile(this, report, []);
    return;
  }
  report.closedSettings = await renderProfile(this.context, page);
  report.initialHeap = await heapProfile(this.browser, this.context, page);
  await openCatalog(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  async function query(value) {
    await prompt.fill(value);
    await page.waitForFunction(value => globalThis.__searchPhases.at(-1)?.query === value
      && globalThis.__searchPhases.at(-1)?.frameAt, value, { timeout: 30_000 });
    return page.evaluate(() => structuredClone(globalThis.__searchPhases.at(-1)));
  }
  const cpuStats = async () => {
    const raw = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8').catch(() => null);
    return raw ? Object.fromEntries(raw.trim().split('\n').map(line => {
      const [key, value] = line.split(' '); return [key, Number(value)];
    })) : null;
  };
  for (let sample = 0; sample < 5; sample++) for (const text of ['List projects', 'Create a new project', 'get']) {
    const before = await cpuStats();
    const phase = await query(text);
    const after = await cpuStats();
    phase.containerCpu = before && after ? Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]])) : null;
    report.searches.push({ ...phase, render: await renderProfile(this.context, page),
      matches: await page.locator('[data-operation-id]').count() });
  }
  report.searchHeap = await heapProfile(this.browser, this.context, page);
  report.traffic = await page.evaluate(() => globalThis.__matchingTransfers);
  // Retention is measured before enabling profilers, which can retain script data.
  await closeCatalog(page);
  report.closedSearchHeap = await heapProfile(this.browser, this.context, page);
  await openCatalog(page);
  await query('List projects');
  // Diagnostic samples are a separate pass, never mixed into latency/heap samples.
  const diagnostic = await cpuProfile(this.browser, this.context, page, () => query('Create a new project'));
  assert.ok(diagnostic.profiles.some(target => target.name === 'operation-matching'));
  if (process.env.SCHEMA_PROFILE_OUTPUT) report.matchingModes = await compareBrowserMatching(page);
  const openSchemasStarted = performance.now();
  await schemas(page);
  report.openSchemasMs = performance.now() - openSchemasStarted;
  report.openSchemas = await renderProfile(this.context, page);
  await page.locator('summary[aria-label="Schemas"]').click();
  report.closedSchemas = await renderProfile(this.context, page);
  await saveSchemaProfile(this, report, diagnostic.profiles);
});
