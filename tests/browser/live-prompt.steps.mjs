// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog, searchOperations, workflow, operationNodes } from './workspace.steps.mjs';

const catalog = page => page.getByRole('navigation', { name: 'Operation catalog', exact: true });
const prompt = page => page.getByRole('textbox', { name: 'Prompt', exact: true });
const group = (page, id) => catalog(page).locator(`[data-catalog-group="${id}"] > .catalog-group > summary`);
const matchingNames = page => catalog(page).locator('[data-operation-name]').evaluateAll(items => items.map(item => item.dataset.operationName).sort());

Then('the sidebar prompt filters operations and hides empty catalog groups', async function () {
  const page = this.page;
  await openCatalog(page);
  const initialGroups = await catalog(page).locator('[data-catalog-group]').evaluateAll(items => items.map(item => item.dataset.catalogGroup));
  const controls = page.getByRole('group', { name: 'Workspace', exact: true });
  const placement = await Promise.all([controls.boundingBox(), page.locator('.catalog-prompt').boundingBox(), catalog(page).boundingBox()]);
  assert.ok(placement.every(Boolean));
  assert.ok(placement[1].y >= placement[0].y + placement[0].height && placement[2].y >= placement[1].y + placement[1].height,
    'The prompt belongs below workspace controls and above the operation menu.');
  await searchOperations(page, 'List projects');
  await expect(prompt(page)).toBeFocused();
  assert.deepEqual(await matchingNames(page), ['List projects', 'Get project', 'Example query and header inputs', 'HTTPBin query and header inputs', 'Create task'].sort());
  const filteredGroups = await catalog(page).locator('[data-catalog-group]').evaluateAll(items => items.map(item => ({
    id: item.dataset.catalogGroup, matches: item.querySelectorAll('[data-operation-name]').length
  })));
  assert.ok(filteredGroups.length < initialGroups.length, 'Empty nested categories must be removed.');
  assert.ok(filteredGroups.every(item => item.matches > 0), 'Each remaining category must contain a matching descendant.');
  await expect(group(page, 'projects')).toHaveAttribute('aria-expanded', 'true');
  await expect(group(page, 'overview')).toHaveAttribute('aria-expanded', 'true');
  await expect(group(page, 'tasks')).toHaveAttribute('aria-expanded', 'true');
  await expect(group(page, 'httpbin')).toHaveAttribute('aria-expanded', 'true');
  for (const action of await catalog(page).getByRole('button', { name: /^Add to workflow:/ }).all()) await expect(action).toBeVisible();
  await expect(operationNodes(page, 'List projects')).toHaveCount(0);
  await searchOperations(page, '!!!');
  await expect(page.getByText('No matching operations.', { exact: true })).toBeVisible();
  await expect(catalog(page).locator('[data-catalog-group]')).toHaveCount(0);
  await expect(catalog(page).locator('.catalog-reorder')).toHaveCount(0);
});

Then('clearing live matching restores the unfiltered catalog and its previous expansion', async function () {
  const page = this.page;
  await openCatalog(page);
  const initialNames = await matchingNames(page);
  const initialGroups = await catalog(page).locator('[data-catalog-group]').evaluateAll(items => items.map(item => item.dataset.catalogGroup));
  await group(page, 'projects').click();
  await group(page, 'tasks').click();
  await searchOperations(page, 'List projects');
  await expect(group(page, 'overview')).toHaveAttribute('aria-expanded', 'true');
  await searchOperations(page, '');
  assert.deepEqual(await matchingNames(page), initialNames);
  assert.deepEqual(await catalog(page).locator('[data-catalog-group]').evaluateAll(items => items.map(item => item.dataset.catalogGroup)), initialGroups);
  await expect(group(page, 'projects')).toHaveAttribute('aria-expanded', 'true');
  await expect(group(page, 'tasks')).toHaveAttribute('aria-expanded', 'true');
  await expect(group(page, 'overview')).toHaveAttribute('aria-expanded', 'false');
  await expect(group(page, 'httpbin')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Add to workflow: Update task', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review matching details', exact: true })).toHaveCount(0);
  await expect(prompt(page)).toBeFocused();
});

Then('newer prompt text cancels the pending worker and owns the displayed matches', async function () {
  const page = this.page;
  await openCatalog(page);
  // Hold one real worker request at its boundary so cancellation cannot pass
  // merely because the bundled catalog happened to finish before the next edit.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    const state = { worker: null, request: null, terminated: false,
      restore() { Worker.prototype.postMessage = post; Worker.prototype.terminate = terminate; } };
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.method === 'evaluate' && message.args?.[0] === 'List projects') {
        state.worker = this;
        state.request = message;
        return;
      }
      return post.call(this, message, ...args);
    };
    Worker.prototype.terminate = function () {
      if (this === state.worker) state.terminated = true;
      return terminate.call(this);
    };
    window.__heldMatching = state;
  });
  try {
    await prompt(page).fill('List projects');
    await expect.poll(() => page.evaluate(() => Boolean(window.__heldMatching.request))).toBe(true);
    await expect(page.locator('.catalog-prompt')).toHaveAttribute('aria-busy', 'true');
    await prompt(page).fill('HTTPBin request');
    await expect.poll(() => page.evaluate(() => window.__heldMatching.terminated)).toBe(true);
    await searchOperations(page, 'Get project');
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Add to workflow: Get project', exact: true })).toBeVisible();
    const names = await matchingNames(page);
    await page.evaluate(() => {
      const state = window.__heldMatching;
      state.worker.dispatchEvent(new MessageEvent('message', { data: { kind: 'result', id: state.request.id,
        value: { candidates: [], results: [] } } }));
    });
    await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'Get project');
    assert.deepEqual(await matchingNames(page), names, 'A late cancelled response must not replace the current matches.');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await page.evaluate(() => { window.__heldMatching.restore(); delete window.__heldMatching; });
  }
});

Then('mobile prompt matching preserves editing focus until an operation is selected', async function () {
  const page = this.page;
  await closeCatalog(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const browse = page.locator('.workflow-empty').getByRole('button', { name: 'Browse operations', exact: true });
  await browse.click();
  await expect(prompt(page)).toBeFocused();
  await searchOperations(page, 'Create task');
  await expect(prompt(page)).toBeFocused();
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Operation catalog', exact: true }) })).toBeVisible();
  await page.getByRole('button', { name: 'Add to workflow: Create task', exact: true }).click();
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Operation catalog', exact: true }) })).toHaveCount(0);
  await expect(operationNodes(page, 'Create task')).toHaveCount(1);
  await expect(operationNodes(page, 'Create task')).toBeFocused();
  await expect(workflow(page)).toBeVisible();
  await openCatalog(page);
  await expect(prompt(page)).toHaveValue('Create task');
  await expect(page.getByRole('button', { name: 'Add to workflow: Create task', exact: true })).toBeVisible();
});

Then('a long prompt grows inside navigation while its buttons and menu remain usable', async function () {
  const page = this.page;
  await openCatalog(page);
  const before = await prompt(page).boundingBox();
  await expect(prompt(page)).toHaveAttribute('rows', '1');
  await expect(prompt(page)).toHaveAttribute('placeholder', 'Search');
  await expect(page.locator('.catalog-prompt').getByRole('heading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Commonly used operations', exact: true })).toHaveCount(0);
  await expect(page.locator('.catalog-prompt .prompt-actions')).toHaveCount(0);
  const menuHeight = await catalog(page).locator('.catalog-group > summary').first().evaluate(option => option.offsetHeight);
  assert.ok(before);
  assert.equal(before.height, menuHeight, 'The empty prompt matches the menu option height.');
  await searchOperations(page, 'List projects\nGet project\nCreate task\nUpdate task\nHTTPBin request\nExample request');
  await expect.poll(() => prompt(page).evaluate(input => input.clientHeight >= input.scrollHeight)).toBe(true);
  const after = await prompt(page).boundingBox();
  assert.ok(before && after && after.height > before.height, 'Multiline text must grow the prompt instead of introducing its own scrollbar.');
  await expect(prompt(page)).toHaveCSS('overflow-y', 'hidden');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await searchOperations(page, '');
  await expect.poll(() => prompt(page).evaluate(input => input.getBoundingClientRect().height)).toBe(before.height);
});
