// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run: node tests/schemas-settings.smoke.mjs (isolated Vite server and Brave contexts).
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const directory = resolve('tmp/test/schemas-settings');
const fixtureId = 'virtual:schemas-settings-inspection';
const title = 'Schema smoke API';
const makeDocument = (name = title, version = '1.0.0') => ({
  openapi: '3.1.0', info: { title: name, version },
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
const server = await createServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce',
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

async function navigate(page, mode) {
  const run = page.getByRole('dialog', { name: /^Run workflow:/ });
  if (await run.isVisible()) {
    await run.getByRole('button', { name: 'Quit', exact: true }).click();
    await expect(run).toHaveCount(0);
  }
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await open.isVisible()) await open.click();
  await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: mode, exact: true }).click();
  const close = page.getByRole('button', { name: 'Close navigation', exact: true });
  if (await close.isVisible()) await close.click();
}

async function enterSchemas(page) {
  await expect(page.locator('#startup-status')).toHaveCount(0, { timeout: 45000 });
  await navigate(page, 'Settings');
  const summary = page.locator('summary[aria-label="Schemas"]');
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
  await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toBeVisible();
}

const panel = page => page.getByRole('region', { name: 'OpenAPI documents', exact: true });
const card = (page, id) => panel(page).locator(`[data-schema-id="${id}"]`);
const records = page => page.evaluate(async () => (await import('/lib/schema-storage.ts')).loadSchemaDocuments());
const history = (page, id) => page.evaluate(async id => (await import('/lib/schema-storage.ts')).getSchemaHistory(id), id);
const liveOperationIds = page => page.evaluate(async () => (await import('/lib/catalog.ts')).operations.map(operation => operation.id));
async function idle(page) { await expect(panel(page)).toHaveAttribute('aria-busy', 'false'); }
async function upload(page, name, document) {
  await panel(page).locator('input[type=file][aria-label="Upload OpenAPI document"]').setInputFiles({
    name, mimeType: /\.json$/i.test(name) ? 'application/json' : 'application/yaml',
    buffer: Buffer.from(typeof document === 'string' ? document : JSON.stringify(document))
  });
  await idle(page);
}
async function replace(page, id, name, document) {
  const chooser = page.waitForEvent('filechooser');
  await card(page, id).getByRole('button', { name: /^Replace / }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await idle(page);
}

try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true });
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

    const fullSchemaRecord = initial.find(record => record.id === 'httpbin');
    const fullSchemaCard = card(page, fullSchemaRecord.id);
    const schemaTrigger = fullSchemaCard.locator('summary[aria-label="OpenAPI schema"]');
    const schemaLabel = `Full OpenAPI JSON: ${fullSchemaRecord.document.info.title}`;
    const fullSchema = fullSchemaCard.getByRole('region', { name: schemaLabel, exact: true });
    const scopeHeader = path => fullSchema.getByRole('group', { name: `${schemaLabel}: ${path}`, exact: true }).locator(':scope > summary');
    const headerBackground = () => schemaTrigger.evaluate(element => getComputedStyle(element).backgroundColor);
    const closedBackground = await headerBackground();
    await expect(fullSchemaCard.locator('.json-view')).toHaveCount(0);
    await schemaTrigger.click();
    await expect(fullSchema).toBeVisible();
    await expect(fullSchema.getByText('"info"', { exact: true })).toBeVisible();
    await expect(fullSchema.getByText('"components"', { exact: true })).toBeVisible();
    const visiblePaths = Object.keys(fullSchemaRecord.document.paths).slice(0, 2);
    for (const path of visiblePaths) await expect(fullSchema.getByText(JSON.stringify(path), { exact: true })).toBeVisible();
    const expectedExpandedScopes = ['$', '$["paths"]', ...Object.keys(fullSchemaRecord.document.paths).map(path => `$["paths"][${JSON.stringify(path)}]`)];
    const assertOperationPreset = async () => {
      assert.deepEqual(await fullSchema.locator('summary[aria-expanded="true"]').evaluateAll(summaries => summaries
        .map(summary => summary.parentElement.getAttribute('aria-label'))), expectedExpandedScopes.map(path => `${schemaLabel}: ${path}`));
      for (const path of ['$["info"]', '$["components"]', '$["servers"]']) await expect(scopeHeader(path)).toHaveAttribute('aria-expanded', 'false');
      for (const path of visiblePaths) {
        const itemPath = `$["paths"][${JSON.stringify(path)}]`;
        for (const method of Object.keys(fullSchemaRecord.document.paths[path])) {
          const operationPath = `${itemPath}[${JSON.stringify(method)}]`;
          await expect(scopeHeader(operationPath)).toHaveAttribute('aria-expanded', 'false');
          await expect(fullSchema.getByRole('group', { name: `${schemaLabel}: ${itemPath}`, exact: true })
            .getByText(JSON.stringify(method), { exact: true })).toBeVisible();
        }
      }
    };
    await assertOperationPreset();
    await expect(fullSchema.getByText('"operationId"', { exact: true })).toHaveCount(0);
    await expect(fullSchema.getByText('"title"', { exact: true })).toHaveCount(0);
    await expect(fullSchemaCard.getByRole('button', { name: 'Copy JSON', exact: true })).toBeVisible();
    await expect(fullSchemaCard.getByRole('button', { name: 'Wrap lines', exact: true })).toBeVisible();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await fullSchemaCard.getByRole('button', { name: 'Copy JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()))).toEqual(fullSchemaRecord.document);
    const rootBracket = fullSchema.locator('.json-tree > .json-branch > summary');
    await rootBracket.click();
    await expect(rootBracket).toHaveAttribute('aria-expanded', 'false');
    await expect(fullSchema.getByText('"info"', { exact: true })).not.toBeVisible();
    await rootBracket.click();
    await expect(rootBracket).toHaveAttribute('aria-expanded', 'true');
    await expect(fullSchema.getByText('"components"', { exact: true })).toBeVisible();
    const firstMethod = Object.keys(fullSchemaRecord.document.paths[visiblePaths[0]])[0];
    const firstOperationPath = `$["paths"][${JSON.stringify(visiblePaths[0])}][${JSON.stringify(firstMethod)}]`;
    const firstOperationId = fullSchemaRecord.document.paths[visiblePaths[0]][firstMethod].operationId;
    await scopeHeader(firstOperationPath).click();
    await expect(fullSchema.getByText(JSON.stringify(firstOperationId), { exact: true })).toBeVisible();
    await scopeHeader('$["info"]').click();
    await expect(fullSchema.getByText('"title"', { exact: true })).toBeVisible();
    await schemaTrigger.focus();
    await schemaTrigger.press('Enter');
    await expect(schemaTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(schemaTrigger).toBeFocused();
    await expect.poll(headerBackground).toBe(closedBackground);
    await schemaTrigger.hover();
    await expect(schemaTrigger).toBeFocused();
    await expect.poll(headerBackground).toBe(closedBackground);
    await expect(fullSchemaCard.locator('.json-view')).toHaveCount(1);
    await expect(fullSchema).not.toBeVisible();
    await schemaTrigger.press('Enter');
    await expect(fullSchema).toBeVisible();
    await assertOperationPreset();
    await expect(fullSchema.getByText(JSON.stringify(firstOperationId), { exact: true })).not.toBeVisible();
    await expect(fullSchema.getByText('"title"', { exact: true })).not.toBeVisible();
    await schemaTrigger.press('Enter');
    await expect(fullSchema).not.toBeVisible();
    results.fullSchemaViewer = { id: fullSchemaRecord.id, paths: visiblePaths, lazy: true, collapsible: true, copiedCompleteDocument: true,
      operationPreset: true, reopenResets: true, focusedClosedHeaderUsesBaseBackground: true };

    const original = makeDocument();
    await upload(page, 'Inventory.JSON', original);
    const first = (await records(page)).find(record => record.document.info.title === title);
    assert.ok(first);
    await expect(card(page, first.id).getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue(title);
    const operationId = `${first.id}:listInventory`;
    await expect(card(page, first.id)).toContainText('https://schema-smoke.invalid/v1');
    await expect(card(page, first.id).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => liveOperationIds(page)).toContain(operationId);
    assert.equal((await history(page, first.id)).length, 1);
    assert.equal(await panel(page).locator('input[aria-label="Upload OpenAPI document"]').inputValue(), '');
    results.upload = { id: first.id, repository: `/repositories/${first.id}` };

    await navigate(page, 'Workflows');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const operationEntry = page.locator(`[data-operation-id="${operationId}"]`);
    const catalogBranches = await operationEntry.locator('xpath=ancestor::details').all();
    for (const branch of catalogBranches) {
      const summary = branch.locator(':scope > summary');
      if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
    }
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

    await enterSchemas(page);
    const siblingDocument = makeDocument('Sibling schema smoke');
    await upload(page, 'Inventory.JSON', siblingDocument);
    const sibling = (await records(page)).find(record => record.document.info.title === 'Sibling schema smoke');
    assert.ok(sibling);
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

    await enterSchemas(page);
    const revised = { ...makeDocument(title, '2.0.0'), servers: [{ url: 'https://schema-smoke.invalid/v2' }] };
    await replace(page, first.id, 'Inventory.JSON', revised);
    await expect(card(page, first.id)).toContainText('https://schema-smoke.invalid/v2');
    const versions = await history(page, first.id);
    assert.equal(versions.length, 2);
    assert.deepEqual(versions[0].parents, [versions[1].oid]);
    assert.deepEqual(await page.evaluate(async ({ id, oid }) => (await import('/lib/schema-storage.ts')).readSchemaVersion(id, oid),
      { id: first.id, oid: versions[1].oid }), original);
    results.replace = { id: first.id, commits: versions.map(version => version.oid) };
    await navigate(page, 'Workflows');
    await expect(responseBody).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
    await expect(operationNode).toHaveAttribute('data-id', operationNodeId);
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start workflow', exact: true })).toBeVisible();
    results.workflowRetainedAcrossSchemaChanges = true;

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
    await expect.poll(() => liveOperationIds(page)).toContain(`${yamlRecord.id}:checkHealth`);
    await expect(panel(page).locator('[data-schema-id]')).toHaveCount(initial.length + 3);
    results.duplicateFilenameAndYaml = { sibling: sibling.id, yaml: yamlRecord.id };

    const downloadEvent = page.waitForEvent('download');
    await card(page, first.id).getByRole('button', { name: `Download ${title}`, exact: true }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'inventory.json');
    assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), revised);
    results.download = true;

    const beforeInvalid = await records(page);
    await upload(page, 'broken.yaml', 'openapi: [broken');
    await expect(panel(page).getByRole('alert')).toContainText('Could not parse broken.yaml');
    assert.deepEqual(await records(page), beforeInvalid);
    await replace(page, first.id, 'Inventory.JSON', { ...revised, openapi: '2.0.0' });
    await expect(panel(page).getByRole('alert')).toContainText('Only OpenAPI 3.0 and 3.1');
    assert.deepEqual(await records(page), beforeInvalid);
    assert.deepEqual(await history(page, first.id), versions);
    results.invalidDocumentsPreservedState = true;

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
    const renameCard = card(page, yamlRecord.id);
    const beforeRename = await history(page, yamlRecord.id);
    const nameInput = renameCard.getByRole('textbox', { name: 'Schema name', exact: true });
    await expect(nameInput).toHaveValue('YAML schema smoke');
    await expect(nameInput).toBeEditable();
    await expect(renameCard.getByRole('button', { name: /^(Edit schema name|Save schema name|Cancel rename)$/ })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(await nameInput.evaluate(input => {
      const slot = input.previousElementSibling;
      const icon = slot.querySelector('.material-symbols-rounded');
      const slotBounds = slot.getBoundingClientRect(), inputBounds = input.getBoundingClientRect();
      return { width: slot.offsetWidth, height: slot.offsetHeight, inputHeight: input.offsetHeight,
        icon: icon.textContent, iconWidth: icon.getBoundingClientRect().width,
        connected: Math.abs(slotBounds.right - inputBounds.left) < 1 };
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
    await expect(card(page, yamlRecord.id).getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue('Renamed with Enter');
    results.rename = { id: yamlRecord.id, title: 'Renamed with Enter', blurAndEnterSave: true, unchangedAndEmptyNotCommitted: true };

    const order = () => panel(page).locator('[data-schema-id]').evaluateAll(cards => cards
      .sort((left, right) => left.offsetTop - right.offsetTop).map(element => element.dataset.schemaId));
    const beforeOrder = await order();
    const beforeMoveHistory = Object.fromEntries(await Promise.all(beforeOrder.map(async id => [id, await history(page, id)])));
    const moveButton = id => card(page, id).getByRole('button', { name: /^Move / });
    await page.setViewportSize({ width: 1280, height: 1800 });
    assert.deepEqual(await moveButton(beforeOrder[0]).evaluate(button => {
      const icon = button.querySelector('.material-symbols-rounded');
      return { width: button.offsetWidth, height: button.offsetHeight, icon: icon.textContent, iconWidth: icon.getBoundingClientRect().width,
        draggable: button.draggable, last: [...button.closest('.schema-actions').querySelectorAll('button')].at(-1) === button };
    }), { width: 32, height: 32, icon: 'swap_vert', iconWidth: 20, draggable: true, last: true });
    await moveButton(beforeOrder[0]).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    assert.deepEqual(await order(), beforeOrder, 'Clicking the drag handle does not move cards or open a menu');
    await page.evaluate(() => {
      const original = DataTransfer.prototype.setDragImage;
      window.schemaDragImages = [];
      DataTransfer.prototype.setDragImage = function(element, x, y) {
        window.schemaDragImages.push({ id: element.dataset.schemaId, fullCard: element.classList.contains('schema-card') });
        return original.call(this, element, x, y);
      };
    });
    const drag = async (sourceId, targetId, placement, expectedPreview, cancel = false) => {
      const persistedBefore = (await records(page)).map(record => record.id);
      await moveButton(sourceId).scrollIntoViewIfNeeded();
      const source = await moveButton(sourceId).boundingBox(), target = await card(page, targetId).boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 12, { steps: 3 });
      const x = target.x + target.width / 2, y = placement === 'before' ? target.y + 16 : target.y + target.height - 16;
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.move(x, y + 1);
      await expect.poll(order).toEqual(expectedPreview);
      assert.deepEqual((await records(page)).map(record => record.id), persistedBefore, 'Dragging previews order without saving before drop');
      await expect(panel(page).locator('[data-drop]')).toHaveCount(0);
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      await idle(page);
    };
    const firstToLast = [...beforeOrder.slice(1), beforeOrder[0]];
    await drag(beforeOrder[0], beforeOrder.at(-1), 'after', firstToLast);
    await expect.poll(order).toEqual(firstToLast);
    await drag(beforeOrder[0], beforeOrder[1], 'before', beforeOrder);
    await expect.poll(order).toEqual(beforeOrder);
    await drag(beforeOrder[0], beforeOrder.at(-1), 'after', firstToLast, true);
    assert.deepEqual(await order(), beforeOrder, 'Escape cancels dragging without moving cards');
    assert.deepEqual((await records(page)).map(record => record.id), beforeOrder, 'Escape also preserves the stored order');
    await moveButton(beforeOrder[0]).focus();
    await moveButton(beforeOrder[0]).press('ArrowDown');
    await idle(page);
    await expect.poll(order).toEqual([beforeOrder[1], beforeOrder[0], ...beforeOrder.slice(2)]);
    await moveButton(beforeOrder[0]).press('ArrowUp');
    await idle(page);
    await expect.poll(order).toEqual(beforeOrder);

    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const selectedCatalogOperation = page.locator(`[data-operation-id="${yamlRecord.id}:checkHealth"]`);
    for (const branch of await selectedCatalogOperation.locator('xpath=ancestor::details').all()) {
      const summary = branch.locator(':scope > summary');
      if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
    }
    await selectedCatalogOperation.getByRole('button', { name: 'Add to workflow: Check YAML schema health', exact: true }).click();
    const yamlNode = page.locator('.svelte-flow__node-operation').filter({ has: page.locator('[data-operation-name="Check YAML schema health"]') });
    await expect(yamlNode).toBeVisible();
    const yamlNodeId = await yamlNode.getAttribute('data-id');
    await enterSchemas(page);
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const expandedCatalogGroups = await page.locator('.catalog-branch').evaluateAll(branches => branches
      .filter(branch => branch.querySelector(':scope > details > summary')?.getAttribute('aria-expanded') === 'true')
      .map(branch => branch.dataset.catalogGroup));
    const catalogGroupIds = await page.evaluate(async () => Object.fromEntries((await import('/lib/catalog-registry.ts')).catalogs
      .map(catalog => [catalog.id, catalog.groups.map(group => group.id)])));
    const catalogOrder = () => page.locator('nav[aria-label="Operation catalog"] > .catalog-reorder > [data-catalog-group]')
      .evaluateAll(branches => branches.map(branch => branch.dataset.catalogGroup));
    assert.deepEqual(await catalogOrder(), beforeOrder.flatMap(id => catalogGroupIds[id]));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      window.schemaCardAnimations = [];
      window.schemaCatalogAnimations = [];
      Element.prototype.animate = function(keyframes, options) {
        const animation = animate.call(this, keyframes, options);
        if (this.classList.contains('schema-card')) window.schemaCardAnimations.push(animation.effect.getKeyframes().map(frame => frame.transform));
        if (this.classList.contains('catalog-reorder')) window.schemaCatalogAnimations.push(animation.effect.getKeyframes().map(frame => frame.transform));
        return animation;
      };
    });
    const savedOrder = [beforeOrder.at(-1), ...beforeOrder.slice(0, -1)];
    await drag(beforeOrder.at(-1), beforeOrder[0], 'before', savedOrder);
    await expect.poll(order).toEqual(savedOrder);
    const cardAnimations = await page.evaluate(() => window.schemaCardAnimations);
    assert.ok(cardAnimations.some(transforms => new Set(transforms.filter(Boolean)).size > 1), 'Cards animate their transforms while previewing a drag');
    await expect.poll(catalogOrder).toEqual(savedOrder.flatMap(id => catalogGroupIds[id]));
    await expect.poll(() => page.evaluate(() => window.schemaCatalogAnimations.some(transforms => new Set(transforms.filter(Boolean)).size > 1))).toBe(true);
    const catalogAnimations = await page.evaluate(() => window.schemaCatalogAnimations);
    assert.ok(expandedCatalogGroups.length > 0);
    for (const id of expandedCatalogGroups) await expect(page.locator(`[data-catalog-group="${id}"] > details > summary`)).toHaveAttribute('aria-expanded', 'true');
    await expect(selectedCatalogOperation.getByRole('button', { name: 'Add to workflow: Check YAML schema health', exact: true })).toBeVisible();
    await expect(yamlNode).toHaveAttribute('data-id', yamlNodeId);
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await page.evaluate(() => window.schemaDragImages), [beforeOrder[0], beforeOrder[0], beforeOrder[0], beforeOrder.at(-1)]
      .map(id => ({ id, fullCard: true })), 'Native drag gestures use the full card as their drag image');
    await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
    await enterSchemas(page);
    await idle(page);
    assert.deepEqual(await order(), savedOrder, 'Schema order persists across reload');
    assert.deepEqual((await records(page)).map(record => record.id), savedOrder);
    for (const id of beforeOrder) assert.deepEqual(await history(page, id), beforeMoveHistory[id], 'Reordering does not change schema Git history');
    results.reorder = { order: savedOrder, nativeDrag: true, livePreview: true, cardAnimations: cardAnimations.length,
      catalogAnimations: catalogAnimations.length, workflowNodePreserved: true,
      escapeCancels: true, keyboardMoves: true, historiesUnchanged: true };
    await page.setViewportSize({ width: 1280, height: 1000 });

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
    await card(page, largeRecord.id).getByRole('button', { name: 'Delete Large worker schema', exact: true }).click();
    await card(page, largeRecord.id).getByRole('group', { name: 'Confirm deletion of Large worker schema', exact: true })
      .getByRole('button', { name: 'Delete', exact: true }).click();
    await idle(page);
    assert.deepEqual(await order(), savedOrder);
    results.workerResponsiveness = { operations: 1500, busyFrames, workerNames };
    await page.screenshot({ path: resolve(directory, 'schemas-managed.png'), fullPage: true });
    results.deleteIsolationAndWorkflowRetention = true;
  } finally { await context.close(); }

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
  } finally { await retry.context.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS: Schemas upload JSON/YAML, execute catalog operations through Run workflow, preserve workflow nodes across schema updates, start new runs without stale responses, persist across reload, toggle, replace with Git history, download normalized JSON, isolate duplicate filenames, reject invalid changes, delete only the selected repository, retain saved workflows, rename on blur, reorder without changing history, and recover from initial storage failure.');
} finally {
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ results, errors, requests }, null, 2));
  await browser?.close();
  await server.close();
}
