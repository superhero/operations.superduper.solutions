// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, searchOperations, setMode } from './workspace.fixture.mjs';
import { operations } from '../../src/lib/catalog.ts';
import { catalogs } from '../../src/lib/catalog-registry.ts';
import { operationNavigation, operationResourceGroups, navigationOperations } from '../../src/lib/operation-navigation.ts';
import descriptors from '../../src/catalogs/services/index.json' with { type: 'json' };
import { catalogSchemaHeading, catalogResourcePath } from './catalog-hierarchy.fixture.mjs';
import { categoryLabel } from '../../src/lib/category-label.ts';
import { expandSchemaCard, revealSchemaCard, expectSchemaName } from './schema-card.fixture.mjs';

const catalog = page => page.getByRole('navigation', { name: 'Operation catalog', exact: true });
const branch = (page, id, root) => (root ? catalog(page).locator(`[data-catalog-group="${root}"]`) : catalog(page))
  .locator(`[data-catalog-group="${id}"]`);
const heading = (page, id, root) => branch(page, id, root).locator(':scope > .catalog-group > summary');
const operation = (page, id) => catalog(page).locator(`[data-operation-id="${id}"] > .catalog-operation-action`);

Then('Codex schema settings preserve native data and guard unsupported methods', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  const card = page.locator('[data-schema-id="codex"]');
  await expandSchemaCard(card);
  await expect(card.locator('.schema-description')).toContainText('Codex App Server JSON-RPC protocol');
  await expect(card.locator('.schema-operation-count dd')).toHaveText('105');
  await card.locator('.schema-disclosure > summary').click();
  const viewer = card.getByRole('region', { name: 'Full JSON-RPC JSON: OpenAI / Codex / App Server', exact: true });
  await expect(viewer).toBeVisible();
  await expect(card.locator('.schema-disclosure > summary')).toContainText('Codex App Server schema');
  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download OpenAI / Codex / App Server', exact: true }).click();
  const download = await downloadPromise;
  const { readFile } = await import('node:fs/promises');
  const document = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(document['x-codex-app-server'].protocol, 'json-rpc');
  assert.equal(document.definitions.ClientRequest.oneOf.length, 105);
  assert.equal(document.definitions.ServerNotification.oneOf.length, 85);
  assert.equal(document.paths, undefined);
  assert.equal(download.suggestedFilename(), 'codex.schema.json');
  const enabled = card.getByRole('switch');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'false');
  await openCatalog(page);
  await expect(catalog(page).locator('[data-catalog-group="codex"]')).toHaveCount(0);
  await setMode(page, 'settings');
  await revealSchemaCard(card);
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await openCatalog(page);
  await searchOperations(page, 'thread/fork');
  const start = operation(page, 'codex:thread/fork');
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute('aria-disabled', 'true');
  await start.press('Enter');
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(0);
  const requirements = page.getByRole('dialog', { name: 'Requirements: thread/fork', exact: true });
  await expect(requirements).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(requirements).toBeHidden();
  await searchOperations(page, 'thread/start');
  const reviewed = operation(page, 'codex:thread/start');
  await expect(reviewed).toBeVisible(); await expect(reviewed).not.toHaveAttribute('aria-disabled', 'true');
  await reviewed.press('Enter'); await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
});

async function expand(page, id, root) {
  const summary = heading(page, id, root);
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.press('Enter');
}

Then('schema name groups preserve counts search and operation selection', async function () {
  const page = this.page;
  await openCatalog(page);
  const roots = catalog(page).locator(':scope > .catalog-reorder > .catalog-branch > .catalog-group > summary');
  const labels = await roots.locator('.catalog-name').allTextContents();
  assert.equal(labels.filter(name => name === 'Google').length, 1);
  assert.equal(labels.filter(name => name === 'Atlassian').length, 1);
  assert.ok(labels.every(name => !name.includes('/')));
  await expect(catalog(page).locator('[data-operation-id]')).toHaveCount(0);
  const google = roots.filter({ has: page.getByText('Google', { exact: true }) });
  const googleCount = descriptors.filter(source => source.name.startsWith('Google / ')).reduce((sum, source) => sum + source.operations, 0);
  await expect(google.locator('.catalog-count')).toHaveText(String(googleCount));
  const storage = await catalogSchemaHeading(page, 'Google / Cloud / Storage');
  await expect(storage.locator('xpath=../..')).toHaveAttribute('data-catalog-group', 'gcp-storage');
  await expect(storage.locator('.catalog-count')).toHaveText(String(descriptors.find(source => source.id === 'gcp-storage').operations));
  await storage.press('Enter');
  await expand(page, 'gcp-storage:tag:buckets');
  await catalogResourcePath(page, 'gcp-storage:tag:buckets', ['b']);
  const list = operation(page, 'gcp-storage:storage.buckets.list');
  await expect(list).toBeVisible();
  await page.screenshot({ path: `${this.artifactDirectory}/schema-groups-${page.viewportSize().width}.png` });
  // Opening a sibling product closes the Cloud path and clears its descendants.
  await catalogSchemaHeading(page, 'Google / Gemini / Interactions');
  await expect(list).toBeHidden();
  await searchOperations(page, 'storage.buckets.list');
  await expect(google).toHaveAttribute('aria-expanded', 'true');
  await expect(list).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeFocused();
  await searchOperations(page, '!!!');
  await expect(catalog(page).locator('[data-catalog-group]')).toHaveCount(0);
  // An empty result list has no height; the search field remains available.
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('');
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', '');
  const interactions = await catalogSchemaHeading(page, 'Google / Gemini / Interactions');
  await expect(interactions).toHaveAttribute('aria-expanded', 'false');
  await expect(list).toBeHidden();
  await searchOperations(page, 'storage.buckets.list');
  // Corrected Google grant alternatives stay executable when nested and matched.
  await expect(list).toHaveAttribute('aria-disabled', 'false');
  await list.press('Enter');
  const node = page.locator('.svelte-flow__node-operation');
  await expect(node).toHaveCount(1);
  await expect(node).toContainText('storage.buckets.list');
  await openCatalog(page);
  await searchOperations(page, 'getSeriesObservations');
  const supported = operation(page, 'fred:getSeriesObservations');
  await expect(supported).toHaveAttribute('aria-disabled', 'false');
  await supported.focus();
  await expect(supported).toBeFocused();
  await expect(supported).toBeInViewport();
  await supported.press('Enter');
  await expect(node).toHaveCount(2);
  const observations = node.filter({ hasText: 'Get the observations or data values' });
  await expect(observations).toHaveCount(1);
  await expect(observations).toBeFocused();
});

Then('schema name groups follow saved schema names and enablement', async function () {
  const page = this.page;
  const settings = async () => {
    await setMode(page, 'settings');
    const schemas = page.locator('summary[aria-label="Schemas"]');
    if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
    await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toHaveAttribute('aria-busy', 'false');
  };
  await settings();
  const storage = page.locator('[data-schema-id="gcp-storage"]');
  await expandSchemaCard(storage);
  const name = storage.getByRole('textbox', { name: 'Schema name', exact: true });
  await name.fill('Local / Files / Storage');
  await name.press('Enter');
  await expect(storage.getByRole('button', { name: /^Schema details:/ })).toHaveAttribute('aria-label', 'Schema details: Local / Files / Storage');
  await openCatalog(page);
  const renamed = await catalogSchemaHeading(page, 'Local / Files / Storage');
  await expect(renamed.locator('xpath=../..')).toHaveAttribute('data-catalog-group', 'gcp-storage');
  await settings();
  await revealSchemaCard(storage);
  await storage.getByRole('switch').click();
  await expect(storage.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toHaveAttribute('aria-busy', 'false');
  await openCatalog(page);
  await expect(catalog(page).locator('.catalog-name').filter({ hasText: /^Local$/ })).toHaveCount(0);
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await settings();
  await revealSchemaCard(storage);
  await expectSchemaName(storage, 'Local / Files / Storage');
  await storage.getByRole('switch').click();
  await expect(storage.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toHaveAttribute('aria-busy', 'false');
  await openCatalog(page);
  await expect((await catalogSchemaHeading(page, 'Local / Files / Storage')).locator('xpath=../..')).toHaveAttribute('data-catalog-group', 'gcp-storage');
});

Then('catalog groups count their operations and keep one open descendant path', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCatalog(page);
  const ids = operations.map(operation => operation.id);
  await expect(catalog(page).locator('[data-operation-id]')).toHaveCount(0);
  for (const source of catalogs) {
    const root = source.groups[0];
    await expand(page, root.id);
    const expectedIds = operations.filter(operation => operation.id.startsWith(`${source.id}:`)).map(operation => operation.id);
    await expect(heading(page, root.id).locator('.catalog-count')).toHaveText(String(expectedIds.length));
    const index = operationNavigation(operations);
    const total = group => (group.operationIds?.length ?? 0) + (group.children ?? []).reduce((sum, child) => sum + total(child), 0);
    async function inspect(group) {
      await expand(page, group.id, root.id);
      await expect(heading(page, group.id, root.id).locator('.catalog-count')).toHaveText(String(total(group)));
      await expect(heading(page, group.id, root.id)).toHaveAccessibleName(`${categoryLabel(group.name)} group, ${total(group)} operations`);
      await expect(branch(page, group.id, root.id).locator('[data-operation-id]')).toHaveCount(navigationOperations(group.operationIds ?? [], index, null).length);
      for (const child of group.children ?? []) await inspect(child);
    }
    for (const group of operationResourceGroups(root.children, index)) await inspect(group);
  }
  await expand(page, 'projects');
  await expect(heading(page, 'httpbin')).toHaveAttribute('aria-expanded', 'false');
  await expand(page, 'overview');
  await catalogResourcePath(page, 'overview', ['projects']);
  await expect(operation(page, 'demo:listProjects')).toBeVisible();
  await expect(operation(page, 'demo:getProject')).toBeVisible();
  await expand(page, 'tasks');
  await expect(heading(page, 'overview')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'demo:getProject')).toBeHidden();
  await catalogResourcePath(page, 'tasks', ['projects', 'tasks']);
  await expect(operation(page, 'demo:createTask')).toBeVisible();
  await expand(page, 'httpbin');
  await expect(heading(page, 'projects')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'demo:createTask')).toBeHidden();
  await expand(page, 'methods', 'httpbin');
  await catalogResourcePath(page, 'methods', ['anything', 'methods', 'get'], 'httpbin');
  await expect(operation(page, 'httpbin:echoGet')).toBeVisible();
  await expand(page, 'projects');
  await expect(heading(page, 'httpbin')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'httpbin:echoGet')).toBeHidden();
  await heading(page, 'projects').press('Enter');
  await expect(heading(page, 'projects')).toBeFocused();
  await expand(page, 'projects');
  for (const id of ['overview', 'tasks']) await expect(heading(page, id)).toHaveAttribute('aria-expanded', 'false');
  for (const id of ids) await expect(operation(page, id)).toBeHidden();
  await expect(catalog(page).getByRole('button', { name: /^Add to workflow:/ })).toHaveCount(0);
});

Then('nested catalog entries add operations to the workflow with useful focus', async function () {
  const page = this.page;
  await openCatalog(page);
  await expand(page, 'projects');
  await expand(page, 'tasks');
  await catalogResourcePath(page, 'tasks', ['projects', 'tasks']);
  await expect(operation(page, 'demo:createTask')).toHaveAccessibleName('Add to workflow: Example POST body');
  await operation(page, 'demo:createTask').press('Enter');
  const nodes = page.locator('.svelte-flow__node-operation');
  await expect(nodes).toHaveCount(1);
  await expect(nodes).toContainText('Example POST body');
  await expect(nodes).toBeFocused();
  await openCatalog(page);
  await expand(page, 'projects');
  await expand(page, 'overview');
  await catalogResourcePath(page, 'overview', ['projects']);
  await expect(operation(page, 'demo:listProjects')).toHaveAccessibleName('Add to workflow: Example array response');
  await operation(page, 'demo:listProjects').press('Space');
  await expect(nodes).toHaveCount(2);
  const node = nodes.filter({ has: page.locator('[data-operation-name="Example array response"]') });
  await expect(node).toContainText('Example array response');
  await expect(node).toBeFocused();
});
