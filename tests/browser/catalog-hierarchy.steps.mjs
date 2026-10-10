// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, setMode } from './workspace.steps.mjs';
import { operations } from '../../src/lib/catalog.ts';
import { catalogs } from '../../src/lib/catalog-registry.ts';

const catalog = page => page.getByRole('navigation', { name: 'Operation catalog', exact: true });
const branch = (page, id, root) => (root ? catalog(page).locator(`[data-catalog-group="${root}"]`) : catalog(page))
  .locator(`[data-catalog-group="${id}"]`);
const heading = (page, id, root) => branch(page, id, root).locator(':scope > .catalog-group > summary');
const operation = (page, id) => catalog(page).locator(`[data-operation-id="${id}"] > .catalog-operation-action`);

async function expand(page, id, root) {
  const summary = heading(page, id, root);
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.press('Enter');
}

Then('catalog groups count their operations and keep one open descendant path', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCatalog(page);
  const ids = await catalog(page).locator('[data-operation-id]').evaluateAll(elements => elements.map(element => element.dataset.operationId));
  assert.deepEqual(ids, operations.map(operation => operation.id));
  for (const source of catalogs) {
    const root = source.groups[0];
    await expand(page, root.id);
    const expectedIds = operations.filter(operation => operation.id.startsWith(`${source.id}:`)).map(operation => operation.id);
    assert.deepEqual(await branch(page, root.id).locator('[data-operation-id]')
      .evaluateAll(elements => elements.map(element => element.dataset.operationId)), expectedIds);
    for (const group of [root, ...root.children]) {
      const parent = group === root ? undefined : root.id;
      const count = group === root ? expectedIds.length : group.operationIds.length;
      await expect(branch(page, group.id, parent).locator('[data-operation-id]')).toHaveCount(count);
      await expect(heading(page, group.id, parent).locator('.catalog-count')).toHaveText(String(count));
      await expect(heading(page, group.id, parent)).toHaveAccessibleName(`${group.name} group, ${count} operations`);
    }
  }
  await expand(page, 'projects');
  await expect(heading(page, 'httpbin')).toHaveAttribute('aria-expanded', 'false');
  await expand(page, 'overview');
  await expect(operation(page, 'demo:listProjects')).toBeVisible();
  await expect(operation(page, 'demo:getProject')).toBeVisible();
  await expand(page, 'tasks');
  await expect(heading(page, 'overview')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'demo:getProject')).toBeHidden();
  await expect(operation(page, 'demo:createTask')).toBeVisible();
  await expand(page, 'httpbin');
  await expect(heading(page, 'projects')).toHaveAttribute('aria-expanded', 'false');
  await expect(heading(page, 'tasks')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'demo:createTask')).toBeHidden();
  await expand(page, 'methods', 'httpbin');
  await expect(heading(page, 'methods', 'projects')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'httpbin:echoGet')).toBeVisible();
  await expand(page, 'projects');
  await expect(heading(page, 'httpbin')).toHaveAttribute('aria-expanded', 'false');
  await expect(heading(page, 'methods', 'httpbin')).toHaveAttribute('aria-expanded', 'false');
  await expect(operation(page, 'httpbin:echoGet')).toBeHidden();
  await heading(page, 'projects').press('Enter');
  await expect(heading(page, 'projects')).toBeFocused();
  await expand(page, 'projects');
  for (const id of ['overview', 'tasks']) await expect(heading(page, id)).toHaveAttribute('aria-expanded', 'false');
  for (const id of ids) await expect(operation(page, id)).toBeHidden();
  await expect(catalog(page).getByRole('button', { name: /^Open form:/ })).toHaveCount(0);
});

Then('nested catalog entries open a form and add an operation to the workflow', async function () {
  const page = this.page;
  await openCatalog(page);
  await expand(page, 'projects');
  await expand(page, 'tasks');
  await expect(operation(page, 'demo:createTask')).toHaveAccessibleName('Open form: Create task');
  await operation(page, 'demo:createTask').press('Enter');
  await expect(page.getByRole('heading', { name: 'Operation: Create task', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Project ID', exact: true })).toBeFocused();
  await setMode(page, 'workflow');
  await openCatalog(page);
  await expand(page, 'projects');
  await expand(page, 'overview');
  await expect(operation(page, 'demo:listProjects')).toHaveAccessibleName('Add to workflow: List projects');
  await operation(page, 'demo:listProjects').press('Space');
  const node = page.locator('.svelte-flow__node-operation');
  await expect(node).toHaveCount(1);
  await expect(node).toContainText('List projects');
  await expect(node).toBeFocused();
});
