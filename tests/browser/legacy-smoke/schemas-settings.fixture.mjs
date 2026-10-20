// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { exampleCatalogState } from "../catalog-state.fixture.mjs";
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createFixtureServer, ownedBrowser, openSettings, closeSettings } from './support.mjs';
import { catalogResourcePath } from '../catalog-hierarchy.fixture.mjs';

// Assertions are advanced by the named steps in legacy-smoke.feature.
export async function* journey(world, variant) {

const directory = world.artifactDirectory;
const fixtureId = 'virtual:schemas-settings-inspection';
const title = 'Schema smoke API';
const makeDocument = (name = title, version = '1.0.0') => ({
  openapi: '3.1.0', info: { title: name, version, description: `Inventory schema version ${version} used by the browser management checks.` },
  servers: [{ url: 'https://schema-smoke.invalid/v1' }],
  tags: [{ name: 'Schema smoke' }],
  paths: { '/items': { get: { operationId: 'listInventory', summary: `List ${name} inventory`, tags: ['Schema smoke'],
    responses: { '200': { description: 'Inventory', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } } } }
});
const yaml = `openapi: 3.0.3
info:
  title: YAML schema smoke
  version: 1.0.0
servers:
  - url: https://schema-smoke.invalid/yaml
paths:
  /health:
    get:
      operationId: checkHealth
      summary: Check YAML schema health
      responses:
        '200':
          description: Healthy
`;
const results = {}, errors = [], requests = [];
await mkdir(directory, { recursive: true });
const server = await createFixtureServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
  cacheDir: resolve(directory, '.vite'), server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
  plugins: [{ name: 'schemas-settings-inspection',
    resolveId(id) { if (id === fixtureId) return `\0${fixtureId}`; },
    load(id) { if (id === `\0${fixtureId}`) return `
      import LightningFS from '@isomorphic-git/lightning-fs';
      export async function repositoryDirectories(paths) {
        const fs = new LightningFS('v1/catalogs', { defer: true });
        const result = {};
        for (const path of paths) {
          try { result[path] = (await fs.promises.stat(path + '/.git/HEAD')).isFile(); }
          catch (error) { if (error.code !== 'ENOENT') throw error; result[path] = false; }
        }
        return result;
      }
    `; }
  }] });
let browser;

async function openContext(base, name) {
  const context = await browser.newContext({ storageState: exampleCatalogState(base), viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce',
    locale: 'en-US', timezoneId: 'UTC', acceptDownloads: true });
  await context.route('**/*', route => route.request().url().startsWith(`${base}/`) || /^(data|blob):/.test(route.request().url())
    ? route.continue() : route.abort());
  await context.route('https://schema-smoke.invalid/**', route => {
    requests.push({ url: route.request().url(), method: route.request().method() });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json', body: '["one","two"]' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push({ scenario: name, message: error.message }));
  return { context, page };
}

async function expandCatalog(page, id, resource) {
  const root = page.locator(`[data-catalog-group="${id}"]`);
  const header = root.locator(':scope > .catalog-group > summary');
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
  for (const child of await root.locator('.catalog-children > .catalog-branch > .catalog-group > summary').all())
    if (await child.getAttribute('aria-expanded') !== 'true') {
      await child.click();
      await catalogResourcePath(page, await child.locator('xpath=../..').getAttribute('data-catalog-group'), [resource]);
    }
}

async function navigate(page, mode) {
  const run = page.getByRole('dialog', { name: /^Run workflow:/ });
  if (await run.isVisible()) {
    await run.getByRole('button', { name: 'Quit', exact: true }).click();
    await expect(run).toHaveCount(0);
  }
  if (mode === 'Settings') await openSettings(page);
  else await closeSettings(page);
}

async function enterSchemas(page) {
  await expect(page.locator('#startup-status')).toHaveCount(0, { timeout: 45000 });
  await navigate(page, 'Settings');
  const summary = page.locator('summary[aria-label="Schemas"]');
  await expect(summary).toBeVisible();
  // Reopening Settings can restore this disclosure between separate protocol calls.
  await summary.evaluate(element => { if (element.getAttribute('aria-expanded') !== 'true') element.click(); });
  await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toBeVisible();
}

const panel = page => page.getByRole('region', { name: 'OpenAPI documents', exact: true });
const card = (page, id) => panel(page).locator(`[data-schema-id="${id}"]`);
const records = page => page.evaluate(async () => (await import('/lib/schema-storage.ts')).loadSchemaDocuments());
const history = (page, id) => page.evaluate(async id => (await import('/lib/schema-storage.ts')).getSchemaHistory(id), id);
const liveOperationIds = page => page.evaluate(async () => (await import('/lib/catalog.ts')).operations.map(operation => operation.id));
async function idle(page) { await expect(panel(page)).toHaveAttribute('aria-busy', 'false'); }
async function expandCard(page, id) {
  const toggle = card(page, id).getByRole('button', { name: /^Schema details:/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
async function upload(page, name, document) {
  await panel(page).locator('input[type=file][aria-label="Upload OpenAPI document"]').setInputFiles({
    name, mimeType: /\.json$/i.test(name) ? 'application/json' : 'application/yaml',
    buffer: Buffer.from(typeof document === 'string' ? document : JSON.stringify(document))
  });
  await idle(page);
}
async function replace(page, id, name, document) {
  await expandCard(page, id);
  const chooser = page.waitForEvent('filechooser');
  await card(page, id).getByRole('button', { name: /^Replace / }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await idle(page);
}

try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = ownedBrowser(world);
  if (variant === 'full-document') {
    const { context, page } = await openContext(base, 'full-document');
    try {
      await page.goto(base, { waitUntil: 'networkidle', timeout: 90_000 });
      await enterSchemas(page); await idle(page);
      const record = (await records(page)).find(record => record.id === 'httpbin');
      const schemaCard = card(page, record.id);
      await expandCard(page, record.id);
      const trigger = schemaCard.locator('summary[aria-label="OpenAPI schema"]');
      const label = `Full OpenAPI JSON: ${record.document.info.title}`;
      const json = schemaCard.getByRole('region', { name: label, exact: true });
      const background = () => trigger.evaluate(element => getComputedStyle(element).backgroundColor);
      const closedBackground = await background();
      await expect(schemaCard.locator('.json-view')).toHaveCount(0);
      await trigger.click();
      await expect(json).toBeVisible();
      for (const key of ['info', 'components', 'paths']) await expect(json.getByText(JSON.stringify(key), { exact: true })).toBeVisible();
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await schemaCard.getByRole('button', { name: 'Copy JSON', exact: true }).click();
      await expect.poll(() => page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()))).toEqual(record.document);
      const root = json.locator('.json-tree > .json-branch > summary');
      await root.click();
      await expect(root).toHaveAttribute('aria-expanded', 'false');
      await expect(json.getByText('"info"', { exact: true })).not.toBeVisible();
      await root.click();
      await expect(json.getByText('"components"', { exact: true })).toBeVisible();
      const info = json.getByRole('group', { name: `${label}: $["info"]`, exact: true }).locator(':scope > summary');
      await expect(info).toHaveAttribute('aria-expanded', 'true');
      await expect(json.getByText('"title"', { exact: true })).toBeVisible();
      await info.click();
      await expect(info).toHaveAttribute('aria-expanded', 'false');
      await expect(json.getByText('"title"', { exact: true })).not.toBeVisible();
      await trigger.focus(); await trigger.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
      await expect.poll(background).toBe(closedBackground);
      await trigger.hover();
      await expect.poll(background).toBe(closedBackground);
      await expect(schemaCard.locator('.json-view')).toHaveCount(0);
      await expect(json).not.toBeVisible();
      await trigger.press('Enter');
      await expect(json).toBeVisible();
      await expect(info).toHaveAttribute('aria-expanded', 'true');
      await expect(json.getByText('"title"', { exact: true })).toBeVisible();
      await trigger.press('Enter'); await expect(json).not.toBeVisible();
      yield 'the full schema document copies intact and its lazy viewer retains focus and resets nested branches';
    } finally { await context.close(); }
  }

  if (variant === 'management') {
  const { context, page } = await openContext(base, 'management');
  try {
    await page.goto(base, { waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(page);
    await idle(page);
    const workerNames = await Promise.all(page.workers().map(worker => worker.evaluate(() => self.name)));
    assert.ok(workerNames.includes('operations-schema-library'), 'Schema persistence and parsing run in their dedicated worker');
    const initial = await records(page);
    assert.deepEqual(initial.map(record => record.id).sort(), ['demo', 'httpbin']);
    await expect(panel(page).locator('[data-schema-id]')).toHaveCount(initial.length);
    const baselineHistory = Object.fromEntries(await Promise.all(initial.map(async record => [record.id, await history(page, record.id)])));

yield "schema management loads its seeded documents in a dedicated worker";
    const original = makeDocument();
    await upload(page, 'Inventory.JSON', original);
    const first = (await records(page)).find(record => record.document.info.title === title);
    assert.ok(first);
    await expandCard(page, first.id);
    await expect(card(page, first.id).getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue(title);
    const operationId = `${first.id}:listInventory`;
    await expect(card(page, first.id).locator('.schema-description p')).toHaveText(original.info.description);
    await expect(card(page, first.id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => liveOperationIds(page)).toContain(operationId);
    assert.equal((await history(page, first.id)).length, 1);
    assert.equal(await panel(page).locator('input[aria-label="Upload OpenAPI document"]').inputValue(), '');
    results.upload = { id: first.id, repository: `/repositories/${first.id}` };

    await navigate(page, 'Workflows');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expandCatalog(page, first.id, 'items');
    await page.getByRole('button', { name: `Add to workflow: List ${title} inventory`, exact: true }).click();
    const operationNode = page.locator('.svelte-flow__node-operation').filter({ has: page.locator(`[data-operation-name=${JSON.stringify(`List ${title} inventory`)}]`) });
    await expect(operationNode).toBeVisible();
    const operationNodeId = await operationNode.getAttribute('data-id');
    const close = page.getByRole('button', { name: 'Close navigation', exact: true });
    if (await close.isVisible()) await close.click();
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await page.getByRole('button', { name: 'Start workflow', exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    assert.deepEqual(requests[0], { method: 'GET', url: 'https://schema-smoke.invalid/v1/items' });
    const responseBody = page.getByRole('region', { name: 'Response body', exact: true });
    await expect(responseBody).toContainText('"one"');
    results.catalogExecution = true;

yield "an uploaded schema contributes a working workflow operation";
    await enterSchemas(page);
    const siblingDocument = makeDocument('Sibling schema smoke');
    siblingDocument.info.description = ' \t\n ';
    await upload(page, 'Inventory.JSON', siblingDocument);
    const sibling = (await records(page)).find(record => record.document.info.title === 'Sibling schema smoke');
    assert.ok(sibling);
    await expandCard(page, sibling.id);
    await expect(card(page, sibling.id).locator('.schema-description p')).toHaveText(siblingDocument.info.title);
    assert.notEqual(sibling.id, first.id);
    assert.equal(sibling.file, first.file);
    await expect.poll(() => liveOperationIds(page)).toContain(`${sibling.id}:listInventory`);
    const siblingHistory = await history(page, sibling.id);
    await page.evaluate(async () => (await import('/lib/schema-library.ts')).loadSchemaLibrary());
    await idle(page);
    await navigate(page, 'Workflows');
    await expect(operationNode).toBeVisible();
    await expect(operationNode).toHaveAttribute('data-id', operationNodeId);
    assert.equal(requests.length, 1, 'Unrelated uploads and reloads must preserve the workflow without executing it again');
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(responseBody).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start workflow', exact: true })).toBeVisible();

yield "unrelated schema uploads retain workflow nodes without replaying requests";
    await enterSchemas(page);
    const revised = { ...makeDocument(title, '2.0.0'), servers: [{ url: 'https://schema-smoke.invalid/v2' }] };
    const beforeReplace = await history(page, first.id);
    await replace(page, first.id, 'Inventory.JSON', revised);
    await expect(card(page, first.id).locator('.schema-description p')).toHaveText(revised.info.description);
    const versions = await history(page, first.id);
    const published = versions.find(version => version.message === 'Update published schema: Inventory.JSON');
    assert.ok(published);
    assert.equal(versions.length, beforeReplace.length + 2, 'Replacement records the new published source and its working merge.');
    assert.deepEqual(published.parents, [beforeReplace[0].oid]);
    assert.deepEqual(versions[0].parents, [beforeReplace[0].oid, published.oid]);
    assert.deepEqual(await page.evaluate(async ({ id, oid }) => (await import('/lib/schema-storage.ts')).readSchemaVersion(id, oid),
      { id: first.id, oid: beforeReplace[0].oid }), original);
    results.replace = { id: first.id, commits: versions.map(version => version.oid) };
    await navigate(page, 'Workflows');
    await expect(responseBody).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
    await expect(operationNode).toHaveAttribute('data-id', operationNodeId);
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start workflow', exact: true })).toBeVisible();
    results.workflowRetainedAcrossSchemaChanges = true;

yield "schema replacement records its history and clears stale run results";
    await enterSchemas(page);
    await card(page, first.id).getByRole('switch').click();
    await idle(page);
    await expect(card(page, first.id).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => liveOperationIds(page)).not.toContain(operationId);
    assert.deepEqual(await history(page, first.id), versions, 'Enablement metadata must not add a document revision');
    await card(page, first.id).getByRole('switch').click();
    await idle(page);
    await expect.poll(() => liveOperationIds(page)).toContain(operationId);
    await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(page);
    await idle(page);
    await expect(card(page, first.id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => liveOperationIds(page)).toContain(operationId);
    results.enableAndReload = true;

    await upload(page, 'health.YAML', yaml);
    const yamlRecord = (await records(page)).find(record => record.document.info.title === 'YAML schema smoke');
    assert.ok(yamlRecord);
    await expandCard(page, yamlRecord.id);
    await expect(card(page, yamlRecord.id).locator('.schema-description p')).toHaveText(yamlRecord.document.info.title);
    await expect.poll(() => liveOperationIds(page)).toContain(`${yamlRecord.id}:checkHealth`);
    await expect(panel(page).locator('[data-schema-id]')).toHaveCount(initial.length + 3);
    results.duplicateFilenameAndYaml = { sibling: sibling.id, yaml: yamlRecord.id };

    await expandCard(page, first.id);
    const downloadEvent = page.waitForEvent('download');
    await card(page, first.id).getByRole('button', { name: `Download ${title}`, exact: true }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'inventory.json');
    assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), revised);
    results.download = true;

yield "schema enablement YAML uploads and normalized downloads survive reload";
    const beforeInvalid = await records(page);
    await upload(page, 'broken.yaml', 'openapi: [broken');
    await expect(panel(page).getByRole('alert')).toContainText('Could not parse broken.yaml');
    assert.deepEqual(await records(page), beforeInvalid);
    await replace(page, first.id, 'Inventory.JSON', { ...revised, openapi: '2.0.0' });
    await expect(panel(page).getByRole('alert')).toContainText('Only OpenAPI 3.0 and 3.1');
    assert.deepEqual(await records(page), beforeInvalid);
    assert.deepEqual(await history(page, first.id), versions);
    results.invalidDocumentsPreservedState = true;

yield "invalid schema documents cannot change existing state";
    const workflow = await page.evaluate(async operationId => {
      const { operations } = await import('/lib/catalog.ts');
      const { catalogForOperation } = await import('/lib/catalog-registry.ts');
      const { createOperationGraph } = await import('/lib/workflow-graph.ts');
      const { workflowRepository } = await import('/lib/workflow-repository.ts');
      const operation = operations.find(operation => operation.id === operationId);
      const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'schema-smoke-node', catalogForOperation(operationId).document);
      return workflowRepository.save({ version: 3, id: 'schema-retained-workflow', name: 'Retained schema workflow',
        nodes: graph.nodes, edges: graph.edges, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false }, null);
    }, operationId);
    await card(page, first.id).getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    const confirmation = card(page, first.id).getByRole('group', { name: `Confirm deletion of ${title}`, exact: true });
    await expect(confirmation).toContainText('Saved workflows are retained');
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await records(page), beforeInvalid);
    await card(page, first.id).getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await idle(page);
    await expect(card(page, first.id)).toHaveCount(0);
    await expect.poll(() => liveOperationIds(page)).not.toContain(operationId);
    assert.deepEqual(await history(page, sibling.id), siblingHistory);
    for (const record of initial) assert.deepEqual(await history(page, record.id), baselineHistory[record.id]);
    const directoryState = await page.evaluate(async ({ fixtureId, paths }) =>
      (await import(`/@id/${fixtureId}`)).repositoryDirectories(paths),
      { fixtureId, paths: [`/repositories/${first.id}`, `/repositories/${sibling.id}`, `/repositories/${yamlRecord.id}`] });
    assert.deepEqual(directoryState, { [`/repositories/${first.id}`]: false, [`/repositories/${sibling.id}`]: true, [`/repositories/${yamlRecord.id}`]: true });
    assert.deepEqual(await page.evaluate(async () => (await import('/lib/workflow-repository.ts')).workflowRepository.load('schema-retained-workflow')), workflow);
    await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(page);
    await idle(page);
    await expect(card(page, first.id)).toHaveCount(0);
    await expect(card(page, sibling.id)).toBeVisible();
    await expect(card(page, yamlRecord.id)).toBeVisible();
yield "deleting one schema preserves other repositories and saved workflows";
    const renameCard = card(page, yamlRecord.id);
    await expandCard(page, yamlRecord.id);
    const beforeRename = await history(page, yamlRecord.id);
    const nameInput = renameCard.getByRole('textbox', { name: 'Schema name', exact: true });
    await expect(nameInput).toHaveValue('YAML schema smoke');
    await expect(nameInput).toBeEditable();
    await expect(renameCard.getByRole('button', { name: /^(Edit schema name|Save schema name|Cancel rename)$/ })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(await nameInput.evaluate(input => {
      const slot = input.nextElementSibling;
      const icon = slot.querySelector('.material-symbols-rounded');
      const slotBounds = slot.getBoundingClientRect(), inputBounds = input.getBoundingClientRect();
      return { width: slot.offsetWidth, height: slot.offsetHeight, inputHeight: input.offsetHeight,
        icon: icon.textContent, iconWidth: icon.getBoundingClientRect().width,
        connected: Math.abs(inputBounds.right - slotBounds.left) < 1 };
    }), { width: 32, height: 32, inputHeight: 32, icon: 'edit_line', iconWidth: 20, connected: true });
    await nameInput.fill('Discard this name');
    await nameInput.press('Escape');
    await expect(nameInput).toHaveValue('YAML schema smoke');
    assert.deepEqual(await history(page, yamlRecord.id), beforeRename);
    await nameInput.fill('   ');
    await nameInput.press('Tab');
    await expect(panel(page).getByRole('alert')).toContainText('Enter a schema name');
    await expect(nameInput).toHaveValue('   ');
    assert.deepEqual(await history(page, yamlRecord.id), beforeRename);
    await nameInput.fill('  Renamed schema smoke  ');
    assert.deepEqual(await history(page, yamlRecord.id), beforeRename, 'Typing does not save before the field loses focus');
    await nameInput.press('Tab');
    await idle(page);
    await expect(nameInput).toHaveValue('Renamed schema smoke');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    const renamed = (await records(page)).find(record => record.id === yamlRecord.id);
    assert.deepEqual(renamed.document, { ...yamlRecord.document, info: { ...yamlRecord.document.info, title: 'Renamed schema smoke' } });
    const renamedHistory = await history(page, yamlRecord.id);
    assert.equal(renamedHistory.length, beforeRename.length + 1);
    await nameInput.fill('  Renamed schema smoke  ');
    await nameInput.press('Tab');
    await idle(page);
    await expect(nameInput).toHaveValue('Renamed schema smoke');
    assert.deepEqual(await history(page, yamlRecord.id), renamedHistory, 'An unchanged name adds no commit');
    await panel(page).evaluate(section => {
      window.schemaStatusMessages = [];
      window.schemaStatusObserver = new MutationObserver(() => {
        const message = section.querySelector('.schema-status')?.textContent;
        if (message) window.schemaStatusMessages.push(message);
      });
      window.schemaStatusObserver.observe(section, { childList: true, subtree: true, characterData: true });
    });
    await nameInput.fill('Renamed while toggling');
    await renameCard.getByRole('switch').click();
    await idle(page);
    await expect(nameInput).toHaveValue('Renamed while toggling');
    await expect(renameCard.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(renameCard.locator('.schema-description p')).toHaveText('Renamed while toggling');
    assert.equal((await history(page, yamlRecord.id)).length, beforeRename.length + 2);
    await renameCard.getByRole('switch').click();
    await idle(page);
    await expect(renameCard.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    assert.deepEqual(await page.evaluate(() => {
      window.schemaStatusObserver.disconnect();
      return window.schemaStatusMessages;
    }), [], 'Blur-saving and toggling do not display loading status text');
    await nameInput.fill('Renamed with Enter');
    await nameInput.press('Enter');
    await idle(page);
    await expect(nameInput).not.toBeFocused();
    await expect(nameInput).toHaveValue('Renamed with Enter');
    assert.equal((await history(page, yamlRecord.id)).length, beforeRename.length + 3);
    assert.deepEqual(await history(page, sibling.id), siblingHistory);
    await expect.poll(() => liveOperationIds(page)).toContain(`${yamlRecord.id}:checkHealth`);
    await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(page);
    await idle(page);
    await expandCard(page, yamlRecord.id);
    await expect(card(page, yamlRecord.id).getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue('Renamed with Enter');
    results.rename = { id: yamlRecord.id, title: 'Renamed with Enter', blurAndEnterSave: true, unchangedAndEmptyNotCommitted: true };

yield "editable schema names save on blur or Enter without redundant commits";
    const order = () => panel(page).locator('[data-schema-id]').evaluateAll(cards => cards.map(element => element.dataset.schemaId));
    const savedRecords = await records(page);
    const savedOrder = [...savedRecords].sort((left, right) =>
      (left.displayName ?? left.document.info.title).localeCompare(right.displayName ?? right.document.info.title, 'en', { sensitivity: 'base' })
      || left.id.localeCompare(right.id)).map(record => record.id);
    assert.deepEqual(await order(), savedOrder);
    await expect(panel(page).getByRole('button', { name: /^Move / })).toHaveCount(0);
    await expect(panel(page).locator('[draggable="true"]')).toHaveCount(0);
    const histories = Object.fromEntries(await Promise.all(savedOrder.map(async id => [id, await history(page, id)])));
    await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(page);
    await idle(page);
    assert.deepEqual(await order(), savedOrder, 'Displayed names determine the same order after reload');
    for (const id of savedOrder) assert.deepEqual(await history(page, id), histories[id], 'Sorted listing does not change schema history');
    results.ordering = { alphabetical: true, manualControls: false, historiesUnchanged: true };

yield "schema lists stay alphabetical without manual ordering controls or extra revisions";
    const largeDocument = makeDocument('Large worker schema');
    largeDocument.paths = Object.fromEntries(Array.from({ length: 1500 }, (_, index) => [`/items/${index}`, {
      get: { operationId: `workerItem${index}`, summary: `Read worker item ${index}`,
        responses: { '200': { description: 'Worker response', content: { 'application/json': { schema: { type: 'string' } } } } } }
    }]));
    await page.evaluate(() => {
      window.schemaBusyFrames = 0;
      const frame = () => {
        if (document.querySelector('section[aria-label="OpenAPI documents"]')?.getAttribute('aria-busy') === 'true') window.schemaBusyFrames += 1;
        window.schemaFrameRequest = requestAnimationFrame(frame);
      };
      window.schemaFrameRequest = requestAnimationFrame(frame);
    });
    await upload(page, 'large-worker.json', largeDocument);
    const busyFrames = await page.evaluate(() => { cancelAnimationFrame(window.schemaFrameRequest); return window.schemaBusyFrames; });
    assert.ok(busyFrames > 0, 'The main thread continues rendering frames while a large schema is parsed and saved');
    const largeRecord = (await records(page)).find(record => record.document.info.title === 'Large worker schema');
    assert.ok(largeRecord);
    assert.equal((await liveOperationIds(page)).filter(id => id.startsWith(`${largeRecord.id}:`)).length, 1500);
    await expandCard(page, largeRecord.id);
    await card(page, largeRecord.id).getByRole('button', { name: 'Delete Large worker schema', exact: true }).click();
    await card(page, largeRecord.id).getByRole('group', { name: 'Confirm deletion of Large worker schema', exact: true })
      .getByRole('button', { name: 'Delete', exact: true }).click();
    await idle(page);
    assert.deepEqual(await order(), savedOrder);
    results.workerResponsiveness = { operations: 1500, busyFrames, workerNames };
    await page.screenshot({ path: resolve(directory, 'schemas-managed.png'), fullPage: true });
yield "large schema processing yields rendering frames while its worker persists operations";
    results.deleteIsolationAndWorkflowRetention = true;
  } finally { await context.close(); }

  }
  if (variant === 'initial-load-retry') {
  const retry = await openContext(base, 'initial-load-retry');
  try {
    await retry.page.addInitScript(() => {
      // Hold the same origin-wide lock from the window so this also blocks worker-owned storage.
      window.schemaLockHeld = navigator.locks.request('schema-repositories:v1/catalogs', () =>
        new Promise(resolve => { window.releaseSchemaLock = resolve; }));
    });
    await retry.page.goto(base, { waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(retry.page);
    await idle(retry.page);
    await expect(panel(retry.page).getByRole('alert')).toContainText('Schema storage is busy in another tab');
    await expect(panel(retry.page).getByRole('button', { name: 'Upload OpenAPI document', exact: true })).toBeDisabled();
    await expect(panel(retry.page).getByRole('button', { name: 'Reload documents', exact: true })).toBeEnabled();
    await retry.page.evaluate(async () => { window.releaseSchemaLock(); await window.schemaLockHeld; });
    await panel(retry.page).getByRole('button', { name: 'Reload documents', exact: true }).click();
    await idle(retry.page);
    await expect(panel(retry.page).getByRole('alert')).toHaveCount(0);
    await expect(panel(retry.page).getByRole('button', { name: 'Upload OpenAPI document', exact: true })).toBeEnabled();
    assert.equal((await records(retry.page)).length, 2);
    results.initialLoadRetry = true;
    yield 'schema management recovers after the origin-wide repository lock is released';
  } finally { await retry.context.close(); }
  }
  assert.deepEqual(errors, []);
yield "schema browser contexts contain no unexpected errors";

} finally {
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ results, errors, requests }, null, 2));
  await browser?.close();
  await server.close();
}

}
