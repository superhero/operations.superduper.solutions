// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import descriptors from '../../src/catalogs/services/index.json' with { type: 'json' };
import sources from '../../build/service-schemas.sources.json' with { type: 'json' };
import { bundledCatalogs } from '../../src/lib/catalog-registry.ts';
import { setMode, openCatalog, closeCatalog, workflowAction, workspace, fillField } from './workspace.steps.mjs';
import { expandSchemaCard } from './schema-card.fixture.mjs';
import { catalogSchemaHeading } from './catalog-hierarchy.fixture.mjs';

const card = (page, id) => page.locator(`[data-schema-id="${id}"]`);
async function schemas(page) {
  await setMode(page, 'settings');
  const heading = page.locator('summary[aria-label="Schemas"]');
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  const section = page.getByRole('region', { name: 'OpenAPI documents', exact: true });
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await expect(section.getByRole('alert')).toHaveCount(0);
  return section;
}
async function stored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction('catalog').objectStore('catalog').getAll();
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }));
}
async function reload(page) {
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached', timeout: 30_000 });
  await schemas(page);
}

Then('FRED observations and ALFRED vintages are available in separate catalogs and survive workflow reload', { timeout: 60_000 }, async function () {
  const page = this.page;
  await schemas(page);
  for (const [id, name] of [['fred', 'FRED / Federal Reserve Economic Data'], ['alfred', 'ALFRED / Archival Federal Reserve Economic Data']]) {
    await expect(card(page, id).locator('.schema-name-label')).toHaveText(name);
    await expect(card(page, id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await openCatalog(page);
  for (const [id, operation] of [['fred', 'getSeriesObservations'], ['alfred', 'getSeriesVintagedates']]) {
    const root = await catalogSchemaHeading(page, descriptors.find(source => source.id === id).name);
    if (await root.getAttribute('aria-expanded') !== 'true') await root.click();
    const series = page.locator(`[data-catalog-group="${id}:tag:Series"] > .catalog-group > summary`);
    if (await series.getAttribute('aria-expanded') !== 'true') await series.click();
    const entry = page.locator(`[data-operation-id="${id}:${operation}"] > button`);
    await expect(entry).toBeEnabled();
    await entry.click();
  }
  await closeCatalog(page);
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__node-operation').filter({ hasText: 'Get the observations or data values' })).toHaveCount(1);
  await expect(page.locator('.svelte-flow__node-operation').filter({ hasText: 'Get the dates in history' })).toHaveCount(1);
  await expect(page.locator('.svelte-flow__node-operation').getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  await reload(page);
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(2);
  await expect(page.locator('.svelte-flow__node-operation').getByRole('alert')).toHaveCount(0);
});
Then('provider schema names use these paths across saved-label updates', async function (table) {
  const page = this.page;
  const names = table.hashes();
  for (const { id, name } of names) {
    assert.equal(descriptors.find(source => source.id === id)?.name, name);
    assert.equal(sources.find(source => source.id === id)?.name, name);
  }
  await schemas(page);
  const ids = () => page.locator('.schema-card').evaluateAll(cards => cards.map(card => card.dataset.schemaId));
  const initial = await ids();
  for (const { id, name } of names) await expect(card(page, id).locator('.schema-name-label')).toHaveText(name);
  const first = card(page, initial[0]);
  const firstName = await first.locator('.schema-name-label').textContent();
  await first.getByRole('button', { name: `Move ${firstName}`, exact: true }).press('ArrowDown');
  const ordered = [initial[1], initial[0], ...initial.slice(2)];
  await expect.poll(ids).toEqual(ordered);
  const before = await stored(page);
  await page.evaluate(names => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('catalog', 'readwrite');
      const store = tx.objectStore('catalog');
      for (const { id, previous } of names) {
        const read = store.get(id);
        read.onsuccess = () => store.put({ ...read.result, displayName: previous }, id);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), names);
  await reload(page);
  for (const { id, name } of names) await expect(card(page, id).locator('.schema-name-label')).toHaveText(name);
  assert.deepEqual(await ids(), ordered);
  const after = await stored(page);
  for (const { id } of names) {
    const { updatedAt: _before, ...original } = before.find(record => record.id === id);
    const { updatedAt: _after, ...current } = after.find(record => record.id === id);
    assert.deepEqual(current, original, `${id}: a label update must retain the canonical source and metadata.`);
  }
  await reload(page);
  assert.deepEqual(await stored(page), after, 'Current labels must not be written again on every startup.');
});

Then('all Atlassian catalogs share the provider prefix and retain a newly disabled product after reload', { timeout: 60_000 }, async function () {
  const page = this.page;
  const products = descriptors.filter(source => source.provider === 'atlassian');
  assert.equal(products.length, 43);
  await schemas(page);
  for (const source of products) {
    await expect(card(page, source.id).locator('.schema-name-label')).toHaveText(source.name);
    await expect(card(page, source.id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await openCatalog(page);
  for (const source of products) {
    const heading = await catalogSchemaHeading(page, source.name);
    await expect(heading.locator('xpath=../..')).toHaveAttribute('data-catalog-group', source.id);
    await expect(heading.locator('.catalog-name')).toHaveText(source.name.split(' / ').at(-1));
  }
  await (await catalogSchemaHeading(page, 'Atlassian / Statuspage')).click();
  await page.locator('[data-catalog-group="statuspage:tag:pages"] > .catalog-group > summary').click();
  const operation = page.locator('[data-operation-id="statuspage:GET /pages"] > button');
  await expect(operation).toBeEnabled();
  await operation.click();
  await closeCatalog(page);
  await expect(page.locator('.svelte-flow__node-operation')).toContainText('Get a list of pages');
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  await schemas(page);
  await card(page, 'trello').getByRole('switch').click();
  await expect(card(page, 'trello').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toHaveAttribute('aria-busy', 'false');
  await reload(page);
  await expect(page.locator('.svelte-flow__node-operation')).toContainText('Get a list of pages');
  await expect(card(page, 'trello').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(card(page, 'jira').locator('.schema-name-label')).toHaveText('Atlassian / Jira / Cloud');
  await openCatalog(page);
  await catalogSchemaHeading(page, 'Atlassian / Statuspage');
  await expect(page.locator('[data-catalog-group="trello"]')).toHaveCount(0);
  await expect(page.locator('[data-catalog-group="statuspage"] > .catalog-group > summary .catalog-name')).toHaveText('Statuspage');
});

Then('all initial schemas sort by displayed name and keep a manually saved order', async function () {
  const page = this.page;
  const expected = [...bundledCatalogs.map(({ id, name }) => ({ id, name })), ...descriptors]
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
  const ids = () => page.locator('.schema-card').evaluateAll(cards => cards.map(card => card.dataset.schemaId));
  await schemas(page);
  await expect(page.locator('.schema-card')).toHaveCount(expected.length);
  assert.deepEqual(await ids(), expected.map(record => record.id));
  assert.deepEqual(await page.locator('.schema-name-label').allTextContents(), expected.map(record => record.name));

  // Existing installations recorded the examples as the initial order while
  // leaving factory schemas to an ID-based fallback. Upgrade only that default.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(['demo', 'httpbin'], 'order');
      tx.objectStore('state').delete('alphabeticalOrder');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await reload(page);
  assert.deepEqual(await ids(), expected.map(record => record.id));

  const first = expected[0];
  await card(page, first.id).getByRole('button', { name: `Move ${first.name}`, exact: true }).press('ArrowDown');
  const reordered = [expected[1].id, first.id, ...expected.slice(2).map(record => record.id)];
  await expect.poll(ids).toEqual(reordered);
  await reload(page);
  assert.deepEqual(await ids(), reordered);
});

Then('all service schemas appear and preserve disablement renames and deletions after reload', { timeout: 120_000 }, async function () {
  const page = this.page;
  await schemas(page);
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + 2);
  const records = await stored(page);
  for (const source of descriptors) {
    const record = records.find(record => record.id === source.id);
    assert.equal(record.factoryDigest, source.sha256, source.id);
    assert.equal(record.enabled, true, source.id);
    await expect(card(page, source.id).locator('.schema-name-label')).toHaveText(source.name);
  }
  const frankfurter = card(page, 'frankfurter');
  await expandSchemaCard(frankfurter);
  await frankfurter.locator('.schema-disclosure > summary').click();
  await expect(frankfurter.locator('.json-view')).toContainText('/rates');
  await expect(frankfurter.locator('.json-view')).toContainText('get');
  await frankfurter.getByRole('switch').click();
  await expect(frankfurter.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  const mistral = await expandSchemaCard(card(page, 'mistral'));
  const name = mistral.getByRole('textbox', { name: 'Schema name', exact: true });
  await name.fill('My Mistral API');
  await name.press('Enter');
  await expect.poll(async () => (await stored(page)).find(record => record.id === 'mistral').displayName).toBeUndefined();
  await expandSchemaCard(card(page, 'cohere'));
  await card(page, 'cohere').getByRole('button', { name: 'Delete Cohere', exact: true }).click();
  await card(page, 'cohere').getByRole('group', { name: 'Confirm deletion of Cohere', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card(page, 'cohere')).toHaveCount(0);
  // Represent a prior packaged revision without modifying the current bundle.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('catalog', 'readwrite');
      const store = tx.objectStore('catalog');
      const read = store.get('frankfurter');
      read.onsuccess = () => store.put({ ...read.result, factoryDigest: '0'.repeat(64) }, 'frankfurter');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await reload(page);
  assert.equal((await stored(page)).find(record => record.id === 'frankfurter').factoryDigest,
    descriptors.find(source => source.id === 'frankfurter').sha256, 'Unmodified defaults follow the bundled revision.');
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + 1);
  await expect(card(page, 'frankfurter').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(card(page, 'mistral').locator('.schema-name-label')).toHaveText('My Mistral API');
  await expect(card(page, 'cohere')).toHaveCount(0);
  const revised = (await stored(page)).find(record => record.id === 'mistral');
  assert.equal(revised.factoryDigest, undefined, 'Editing a factory document creates an authored Git copy.');
  // Exercise an actual newly installed operation through the normal sidebar/run path.
  await setMode(page, 'workflow');
  await openCatalog(page);
  const root = page.locator('[data-catalog-group="ollama"] > .catalog-group > summary');
  await root.click();
  const groups = page.locator('[data-catalog-group="ollama"] .catalog-children > .catalog-branch > .catalog-group > summary');
  for (const heading of await groups.all()) {
    await heading.click();
    const entry = page.locator('[data-operation-id="ollama:generate"] > button');
    if (await entry.isVisible()) { await entry.click(); break; }
  }
  await expect(page.locator('.svelte-flow__node-operation')).toContainText('Generate a response');
  await closeCatalog(page);
  await workflowAction(page, 'Run');
  const run = workspace(page);
  await expect(run.getByRole('heading', { name: '1. Generate a response', exact: true })).toBeVisible();
  await fillField(page, 'Model', 'test-model');
  await fillField(page, 'Stream', 'false');
  const requests = [];
  await page.route('http://localhost:11434/api/generate', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ model: 'test-model', response: 'A generated response', done: true }) });
  });
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('A generated response');
  assert.deepEqual(requests, [{ model: 'test-model', stream: false }]);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});
Then('the default schema migration preserves an existing custom document and disabled example', { timeout: 90_000 }, async function () {
  const page = this.page;
  await schemas(page);
  const document = { openapi: '3.1.0', info: { title: 'My existing service', version: '1' }, servers: [{ url: 'https://example.com' }],
    paths: { '/custom': { get: { operationId: 'custom', responses: { '200': { description: 'OK' } } } } } };
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.locator('[data-schema-id]')).toHaveCount(3);
  const before = await stored(page);
  const custom = before.find(record => !['demo', 'httpbin'].includes(record.id));
  await card(page, 'demo').getByRole('switch').click();
  await expect(card(page, 'demo').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  // Remove only the explicit fixture's installation marker to represent an
  // existing profile created before service defaults were introduced.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').delete('serviceDefaults');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    opening.onerror = () => reject(opening.error);
  }));
  await reload(page);
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + 3);
  await expect(card(page, custom.id).locator('.schema-name-label')).toHaveText('My existing service');
  await expect(card(page, 'demo').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  assert.deepEqual((await stored(page)).find(record => record.id === custom.id), custom);
});
