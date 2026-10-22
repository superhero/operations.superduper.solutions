// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { versionedSchema } from '../fixtures/operation-versions.mjs';
import { catalogSchemaHeading, catalogResourcePath } from './catalog-hierarchy.fixture.mjs';
import { setMode, openCatalog, closeCatalog, searchOperations, workflowAction, readExport, fillField, executeOperation, quitRun } from './workspace.steps.mjs';

const nodes = page => page.locator('.svelte-flow__node-operation');
const version = page => nodes(page).getByRole('combobox', { name: 'API version', exact: true });
const versionLabel = page => version(page).locator('.select-label');
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
async function addVersionedOperation(page) {
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  const section = page.getByRole('region', { name: 'OpenAPI documents', exact: true });
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await section.locator('input[aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'versions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(versionedSchema())),
  });
  const card = page.locator('.schema-card').filter({ hasText: 'Versioned resource fixture' });
  await expect(card).toHaveCount(1);
  const id = await card.getAttribute('data-schema-id');
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await openCatalog(page);
  const root = await catalogSchemaHeading(page, 'versions.example.test');
  await root.press('Enter');
  await expect(page.locator(`[data-catalog-group="${id}:tag:Operations"]`)).toHaveCount(0);
  const foo = await catalogResourcePath(page, id, ['foo']);
  // Both versions share one action. The descendant is lazy and has no parameter/version heading.
  await expect(foo.locator('[data-operation-id]')).toHaveCount(1);
  await expect(foo.locator('[data-operation-id]')).toHaveAttribute('data-operation-id', `${id}:readV1`);
  const bar = foo.locator(':scope > .catalog-group > .disclosure-panel > .catalog-children > .catalog-branch > .catalog-group > summary');
  await expect(bar.locator('.catalog-name')).toHaveText('Bar');
  await bar.press('Enter');
  await expect(page.locator(`[data-operation-id="${id}:readBar"]`)).toBeVisible();
  await page.locator(`[data-operation-id="${id}:readV1"] > button`).press('Enter');
  await expect(nodes(page)).toHaveCount(1);
  await expect(nodes(page)).toBeFocused();
  await closeCatalog(page);
  await expect(versionLabel(page)).toHaveText('v1');
  return id;
}
async function selectVersion(page, value) {
  await version(page).click();
  await page.getByRole('listbox', { name: 'API version', exact: true }).getByRole('option', { name: value, exact: true }).click();
  await expect(versionLabel(page)).toHaveText(value);
  await expect(version(page)).toBeEnabled();
  await saved(page);
}

Then('nested resources expose one version family and the workflow executes the selected version', async function () {
  const page = this.page;
  const id = await addVersionedOperation(page);
  const initial = (await readExport(page)).document;
  const ownerId = initial.nodes.find(node => node.type === 'operation').id;
  await selectVersion(page, 'version-2');
  const selected = (await readExport(page)).document;
  const owner = selected.nodes.find(node => node.id === ownerId);
  assert.equal(owner.data.operationId, `${id}:readV2`);
  assert.equal(owner.data.path, '/version-2/foo');
  const fields = selected.nodes.filter(node => node.type === 'data' && node.data.direction === 'inputs').flatMap(node => node.data.fields);
  assert.equal(fields.find(field => field.label === 'changed').type, 'Integer');
  assert.ok(fields.some(field => field.label === 'newOnly'));
  assert.ok(!fields.some(field => field.label === 'oldOnly'));
  await page.screenshot({ path: `${this.artifactDirectory}/workflow-api-version-${page.viewportSize().width}.png` });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(versionLabel(page)).toHaveText('v1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(versionLabel(page)).toHaveText('version-2');
  await saved(page);
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(versionLabel(page)).toHaveText('version-2');
  const portable = await readExport(page);
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'versioned-workflow.json', mimeType: 'application/json', buffer: portable.buffer,
  });
  await expect(versionLabel(page)).toHaveText('version-2');
  await saved(page);
  const requests = [];
  await page.route('https://versions.example.test/**', async route => {
    requests.push(route.request().url());
    await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { same: 'result', changed: 7, added: { value: true } } });
  });
  await workflowAction(page, 'Run');
  await fillField(page, 'changed', '7');
  await executeOperation(page);
  await expect.poll(() => requests.length).toBe(1);
  assert.equal(new URL(requests[0]).pathname, '/version-2/foo');
  assert.equal(new URL(requests[0]).searchParams.get('changed'), '7');
  await expect(page.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('result');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await quitRun(page);
  await openCatalog(page);
  await searchOperations(page, 'Read foo v2');
  await expect(page.locator(`[data-operation-id="${id}:readV2"]`)).toBeVisible();
  await page.screenshot({ path: `${this.artifactDirectory}/operation-resources-${page.viewportSize().width}.png` });
});

Then('a pending API version cannot restore a deleted operation', async function () {
  const page = this.page;
  const id = await addVersionedOperation(page);
  await page.evaluate(target => {
    const post = Worker.prototype.postMessage;
    const held = { worker: null, message: null, completed: false, restore: () => { Worker.prototype.postMessage = post; },
      release() {
        this.worker.addEventListener('message', event => { if (event.data.id === this.message.id) this.completed = true; });
        post.call(this.worker, this.message);
      } };
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.method === 'models' && message.args?.[2]?.includes(target)) { held.worker = this; held.message = message; return; }
      return post.call(this, message, ...rest);
    };
    window.__heldVersion = held;
  }, `${id}:readV2`);
  try {
    await version(page).click();
    await page.getByRole('option', { name: 'version-2', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__heldVersion.message))).toBe(true);
    await expect(version(page)).toBeDisabled();
    await nodes(page).focus();
    await page.keyboard.press('Delete');
    await expect(nodes(page)).toHaveCount(0);
    await page.evaluate(() => window.__heldVersion.release());
    await expect.poll(() => page.evaluate(() => window.__heldVersion.completed)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await readExport(page)).document.nodes.length, 0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await page.evaluate(() => { window.__heldVersion.restore(); delete window.__heldVersion; }); }
});

Then('Anthropic operations follow their nested resources without altering their contracts', async function () {
  const page = this.page;
  await openCatalog(page);
  const root = await catalogSchemaHeading(page, 'Anthropic / Claude');
  await root.press('Enter');
  await expect(page.locator('[data-catalog-group="anthropic:tag:Operations"]')).toHaveCount(0);
  const operations = page.locator('[data-catalog-group="anthropic"]');
  const batches = await catalogResourcePath(page, 'anthropic', ['messages', 'batches']);
  await expect(batches.locator(':scope > .catalog-group > summary .catalog-name')).toHaveText('Batches');
  await catalogResourcePath(page, 'anthropic', ['messages', 'batches', 'results']);
  const result = operations.locator('[data-operation-id="anthropic:message_batches_results"]');
  await expect(result).toBeVisible();
  const labels = await operations.locator('.catalog-name').allTextContents();
  assert.ok(!labels.some(name => name === 'Operations' || name === 'v1' || name.startsWith('{')));
  await page.screenshot({ path: `${this.artifactDirectory}/anthropic-resource-navigation.png` });
});
