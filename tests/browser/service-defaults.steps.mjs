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
import { catalogSchemaHeading, catalogResourcePath } from './catalog-hierarchy.fixture.mjs';

Then('Google Workspace YouTube Analytics and Search Console are grouped and Gmail and Drive nodes survive reload', async function () {
  const page = this.page;
  const collection = descriptors.filter(source => source.provider === 'google');
  assert.equal(collection.length, 24);
  await schemas(page);
  for (const source of collection) {
    await expect(card(page, source.id).locator('.schema-name-label')).toHaveText(source.name);
    await expect(card(page, source.id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await openCatalog(page);
  for (const name of ['Google / Workspace', 'Google / YouTube', 'Google / Analytics', 'Google / Search Console']) {
    const group = await catalogSchemaHeading(page, name);
    const sources = collection.filter(source => source.name === name || source.name.startsWith(`${name} / `));
    await expect(group.locator('.catalog-count')).toHaveText(String(sources.reduce((count, source) => count + source.operations, 0)));
  }
  for (const source of collection) {
    const group = await catalogSchemaHeading(page, source.name);
    await expect(group.locator('xpath=../..')).toHaveAttribute('data-catalog-group', source.id);
  }
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  let added = 0;
  for (const [id, query] of [['google-gmail', 'gmail.users.getProfile'], ['google-drive', 'drive.about.get']]) {
    await openCatalog(page);
    await prompt.fill(query);
    await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', query);
    const operation = page.locator(`[data-operation-id="${id}:${query}"] > button`);
    await expect(operation).toHaveAttribute('aria-disabled', 'false');
    await operation.press('Enter');
    await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(++added);
    if (page.viewportSize().width < 900)
      await expect(page.getByRole('navigation', { name: 'Operation catalog', exact: true })).toBeHidden();
  }
  await closeCatalog(page);
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(2);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  const nodes = page.locator('.svelte-flow__node-operation');
  await expect(nodes).toHaveCount(2);
  await expect(nodes.getByRole('alert')).toHaveCount(0);
  await expect(nodes.filter({ hasText: 'gmail.users.getProfile' })).toHaveCount(1);
  await expect(nodes.filter({ hasText: 'drive.about.get' })).toHaveCount(1);
});

Then('Cloudflare Realtime SFU appears beside the account API and its workflow node survives reload', async function () {
  const page = this.page;
  await schemas(page);
  for (const id of ['cloudflare', 'cloudflare-realtime-sfu']) {
    const source = descriptors.find(source => source.id === id);
    await expect(card(page, id).locator('.schema-name-label')).toHaveText(source.name);
    await expect(card(page, id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await openCatalog(page);
  const root = await catalogSchemaHeading(page, 'Cloudflare');
  await expect(root.locator('.catalog-count')).toHaveText('3773');
  const api = await catalogSchemaHeading(page, 'Cloudflare / API');
  await expect(api.locator('.catalog-count')).toHaveText('3761');
  const sfu = await catalogSchemaHeading(page, 'Cloudflare / Realtime / SFU');
  await expect(sfu.locator('.catalog-count')).toHaveText('12');
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const query = 'Return the media tracks and DataChannels';
  await prompt.fill(query);
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', query);
  const operation = page.locator('[data-operation-id="cloudflare-realtime-sfu:GET /apps/{appId}/sessions/{sessionId}"] > button');
  await expect(operation).toHaveAttribute('aria-disabled', 'false');
  await operation.press('Enter');
  await closeCatalog(page);
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  const node = page.locator('.svelte-flow__node-operation');
  await expect(node).toHaveCount(1);
  await expect(node).toContainText('Return the media tracks and DataChannels');
  await expect(node.getByRole('alert')).toHaveCount(0);
});

Then('the cloud collections retain their provider counts and representative workflow contracts', async function () {
  const page = this.page;
  await schemas(page);
  for (const [provider, count, representative] of [['aws', 55, 'aws-ec2'], ['gcp', 52, 'gcp-pubsub'], ['azure', 13, 'azure-keyvault']]) {
    const collection = descriptors.filter(source => source.provider === provider);
    assert.equal(collection.length, count);
    const source = collection.find(source => source.id === representative);
    await expect(card(page, representative).locator('.schema-name-label')).toHaveText(source.name);
    await expect(card(page, representative).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await openCatalog(page);
  for (const [provider, name, representative] of [['aws', 'AWS', 'aws-ec2'], ['gcp', 'Google / Cloud', 'gcp-pubsub'], ['azure', 'Microsoft / Azure', 'azure-keyvault']]) {
    const collection = descriptors.filter(source => source.provider === provider);
    const heading = await catalogSchemaHeading(page, name);
    await expect(heading.locator('.catalog-count')).toHaveText(String(collection.reduce((total, source) => total + source.operations, 0)));
    const source = collection.find(source => source.id === representative);
    const product = await catalogSchemaHeading(page, source.name);
    await expect(product.locator('xpath=../..')).toHaveAttribute('data-catalog-group', representative);
    await expect(product.locator('.catalog-count')).toHaveText(String(source.operations));
  }
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('DescribeInstances');
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'DescribeInstances');
  const aws = page.locator('[data-operation-id="aws-ec2:GET_DescribeInstances"] > button');
  await expect(aws).toHaveAttribute('aria-disabled', 'true');
  await aws.press('Enter');
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Vaults_ListBySubscription');
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'Vaults_ListBySubscription');
  const azure = page.locator('[data-operation-id="azure-keyvault:Vaults_ListBySubscription"] > button');
  await expect(azure).toHaveAttribute('aria-disabled', 'false');
  await azure.press('Enter');
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
  await closeCatalog(page);
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
  await expect(page.locator('.svelte-flow__node-operation').getByRole('alert')).toHaveCount(0);
});

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
  for (const [id, name] of [['fred', 'Federal Reserve / FRED'], ['alfred', 'Federal Reserve / ALFRED']]) {
    await expect(card(page, id).locator('.schema-name-label')).toHaveText(name);
    await expect(card(page, id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  }
  await openCatalog(page);
  for (const [id, operation] of [['fred', 'getSeriesObservations'], ['alfred', 'getSeriesVintagedates']]) {
    const root = await catalogSchemaHeading(page, descriptors.find(source => source.id === id).name);
    if (await root.getAttribute('aria-expanded') !== 'true') await root.click();
    const series = page.locator(`[data-catalog-group="${id}:tag:Series"] > .catalog-group > summary`);
    if (await series.getAttribute('aria-expanded') !== 'true') await series.click();
    await catalogResourcePath(page, `${id}:tag:Series`, ['fred', 'series', id === 'fred' ? 'observations' : 'vintagedates']);
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
  assert.deepEqual(await ids(), initial);
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
  await catalogResourcePath(page, 'statuspage:tag:pages', ['pages']);
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

Then('schemas always sort by displayed name without manual controls', async function () {
  const page = this.page;
  const expected = [...bundledCatalogs.map(({ id, name }) => ({ id, name })), ...descriptors.map(({ id, name }) => ({ id, name }))];
  const ordered = () => [...expected].sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.id.localeCompare(right.id));
  const entries = () => page.locator('.schema-card').evaluateAll(cards => cards.map(card => ({ id: card.dataset.schemaId,
    name: card.querySelector('.schema-name-input')?.value ?? card.querySelector('.schema-name-label')?.textContent })));
  await schemas(page);
  await expect(page.locator('.schema-card')).toHaveCount(expected.length);
  assert.deepEqual(await entries(), ordered());
  await expect(page.getByRole('group', { name: 'Reorder schemas', exact: true })).toHaveCount(0);
  await expect(page.locator('.schema-card').getByRole('button', { name: /^Move / })).toHaveCount(0);
  await expect(page.locator('.schema-card [draggable="true"]')).toHaveCount(0);

  // Complete old arrangements, including stale/duplicate IDs and the old marker,
  // cannot override alphabetical ordering in an existing profile.
  await page.evaluate(ids => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(['missing-schema', ...ids.reverse(), ids[0]], 'order');
      tx.objectStore('state').put(true, 'alphabeticalOrder');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), expected.map(record => record.id));
  await reload(page);
  assert.deepEqual(await entries(), ordered());

  await expandSchemaCard(card(page, 'demo'));
  const input = card(page, 'demo').getByRole('textbox', { name: 'Schema name', exact: true });
  for (const name of ['Zulu example', 'AAA example']) {
    await input.fill(name); await input.press('Enter');
    expected.find(record => record.id === 'demo').name = name;
    await expect.poll(entries).toEqual(ordered());
  }
  const document = { openapi: '3.1.0', info: { title: 'aab uploaded schema', version: '1' },
    servers: [{ url: 'https://sort.example.test' }], paths: { '/items': { get: { operationId: 'list', responses: { '200': { description: 'OK' } } } } } };
  await page.getByRole('button', { name: 'Upload OpenAPI document', exact: true }).click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'sort.openapi.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.locator('.schema-card')).toHaveCount(expected.length + 1);
  const uploaded = (await entries()).find(record => record.name === document.info.title);
  assert.ok(uploaded);
  expected.push(uploaded);
  await expect.poll(entries).toEqual(ordered());
  await reload(page);
  assert.deepEqual(await entries(), ordered());
});

Then('all service schemas appear and preserve disablement renames and default protection after reload', { timeout: 120_000 }, async function () {
  const page = this.page;
  await schemas(page);
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + 2);
  const records = await stored(page);
  for (const source of descriptors) {
    const record = records.find(record => record.id === source.id);
    assert.equal(record.factoryDigest, source.effectiveSha256 ?? source.sha256, source.id);
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
  await expect(card(page, 'cohere').getByRole('button', { name: 'Delete Cohere', exact: true })).toBeDisabled();
  await card(page, 'cohere').getByRole('switch').click();
  await expect(card(page, 'cohere').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(card(page, 'cohere').getByRole('button', { name: 'Delete Cohere', exact: true })).toBeDisabled();
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
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + 2);
  await expect(card(page, 'frankfurter').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(card(page, 'mistral').locator('.schema-name-label')).toHaveText('My Mistral API');
  await expect(card(page, 'cohere')).toHaveCount(1);
  await expect(card(page, 'cohere').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  const revised = (await stored(page)).find(record => record.id === 'mistral');
  assert.equal(revised.factoryDigest, undefined, 'Editing a factory document creates an authored Git copy.');
  // Exercise an actual newly installed operation through the normal sidebar/run path.
  await setMode(page, 'workflow');
  await openCatalog(page);
  const root = page.locator('[data-catalog-group="ollama"] > .catalog-group > summary');
  await root.click();
  await catalogResourcePath(page, 'ollama:tag:Operations', ['api', 'generate']);
  await page.locator('[data-operation-id="ollama:generate"] > button').click();
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
