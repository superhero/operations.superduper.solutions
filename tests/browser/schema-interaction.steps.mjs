// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, searchOperations, setEvaluationDetails } from './workspace.steps.mjs';
import descriptors from '../../src/catalogs/services/index.json' with { type: 'json' };
import { operations } from '../../src/lib/catalog.ts';
import { bundledCatalogs } from '../../src/lib/catalog-registry.ts';

Then('full-library search renders nearby rows and shares tooltip state', async function () {
  const page = this.page;
  await openCatalog(page);
  await searchOperations(page, 'List projects');
  const rows = page.locator('.operation-catalog [data-operation-id] > .catalog-operation-action');
  const count = await rows.count();
  assert.ok(count > 100, `Expected a long menu, got ${count}`);
  if (await rows.first().evaluate(row => 'checkVisibility' in row)) {
    await expect.poll(() => rows.evaluateAll(rows => rows.filter(row => !row.querySelector('.catalog-name').checkVisibility({ contentVisibilityAuto: true })).length)).toBeGreaterThan(count / 2);
  }
  // Offscreen rows retain real focus targets and their natural order.
  const last = rows.last();
  await last.focus(); await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  const finalId = await last.getAttribute('aria-label');
  const adjacent = await rows.evaluateAll(rows => {
    const second = rows.findLast(row => row.parentElement.previousElementSibling?.querySelector('.catalog-operation-action'));
    return [second.parentElement.previousElementSibling.dataset.operationId, second.parentElement.dataset.operationId];
  });
  const before = page.locator(`[data-operation-id="${adjacent[0]}"] > .catalog-operation-action`);
  const after = page.locator(`[data-operation-id="${adjacent[1]}"] > .catalog-operation-action`);
  await after.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(before).toBeFocused();
  await page.keyboard.press('Tab'); await expect(after).toBeFocused();
  const icon = after.locator('.catalog-action-icon');
  await icon.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Add to workflow');
  await expect(page.getByRole('tooltip')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await icon.hover();
  // Scroll cancels opened and pending hints, without creating per-row handlers.
  await page.locator('#side-navigation').evaluate(panel => panel.dispatchEvent(new Event('scroll')));
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // Developer details opt-in causes a full-score evaluation of the same query.
  await setEvaluationDetails(page);
  await expect(page.getByRole('button', { name: 'Review matching details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review matching details', exact: true }).click();
  await expect(page.locator('.evaluation-report')).toBeVisible();
  const operationCount = operations.length + descriptors.reduce((total, source) => total + source.operations, 0);
  await expect(page.locator('.evaluation-report .report-metric-value').nth(2)).toHaveText(String(operationCount));
  await setEvaluationDetails(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Operation catalog', exact: true }) })).toBeVisible();
  await rows.first().locator('.catalog-action-icon').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Add to workflow');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await this.attach(JSON.stringify({ count, finalId }), 'application/json');
});

Then('delegated catalog help preserves disabled explanations anchors and dismissal', async function () {
  const { readFile } = await import('node:fs/promises');
  const { gunzipSync } = await import('node:zlib');
  const { setMode } = await import('./workspace.steps.mjs');
  const index = JSON.parse(gunzipSync(await readFile('src/catalogs/services/indexes/aws-lambda.json.gz')));
  const unavailable = index.operations.find(operation => operation.unavailableReason);
  assert.ok(unavailable);
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCatalog(page);
  await searchOperations(page, unavailable.name);
  const row = page.locator(`[data-operation-id="${unavailable.id}"] > .catalog-operation-action`);
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.catalog-help-scope[data-tooltip-trigger]')).toHaveCount(1);
  await expect(page.locator('[data-operation-id] [data-tooltip-trigger]')).toHaveCount(0);
  await page.locator('#side-navigation').evaluate(async panel => {
    await Promise.all(panel.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  // Programmatic focus follows real keyboard modality, as native Tab does.
  await page.keyboard.press('Tab');
  await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await row.evaluate(element => element.focus({ preventScroll: true }));
  await expect(page.getByRole('tooltip')).toHaveText(unavailable.unavailableReason);
  await expect(row).toHaveAttribute('aria-describedby', /.+/);
  const icon = row.locator('.catalog-action-icon');
  await icon.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Add to workflow');
  const anchor = await icon.boundingBox(), popup = await page.getByRole('tooltip').boundingBox();
  assert.ok(popup.x >= anchor.x + anchor.width - 2, 'The add hint stays beside its icon.');
  await row.locator('.catalog-name').hover();
  await row.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  await row.locator('.catalog-name').hover({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('tooltip')).toHaveText(unavailable.unavailableReason);
  await expect(page.getByRole('tooltip')).toHaveCount(1);
  await page.mouse.move(950, 10);
  // The closing animation retains its label and anchor until presence ends.
  const exiting = page.locator('.app-tooltip[data-state="closed"]');
  await expect(exiting).toHaveText(unavailable.unavailableReason);
  await expect(exiting).toHaveCount(0);
  // Send the real click despite Playwright's aria-disabled actionability guard.
  await row.click({ force: true });
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(0);
  await icon.hover();
  await page.locator('#side-navigation').evaluate(panel => panel.dispatchEvent(new Event('scroll')));
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await icon.dispatchEvent('pointermove', { pointerType: 'touch' });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // A logical trigger can resume without a new native pointerenter, including
  // when a drawer reopens beneath a stationary pointer.
  await icon.dispatchEvent('pointermove', { pointerType: 'mouse' });
  await expect(page.getByRole('tooltip')).toHaveText('Add to workflow');
  for (const enabled of [false, true]) {
    await setMode(page, 'settings');
    const heading = page.locator('summary[aria-label="Application"]');
    if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
    const toggle = page.getByRole('switch', { name: 'Tooltips', exact: true });
    if (await toggle.getAttribute('aria-checked') !== String(enabled)) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
    await openCatalog(page);
    await page.locator('#side-navigation, .settings-drawer').evaluateAll(async panels => {
      await Promise.all(panels.flatMap(panel => panel.getAnimations({ subtree: true }))
        .map(animation => animation.finished.catch(() => {})));
    });
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).evaluate(element => element.blur());
    await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await icon.hover();
    if (enabled) await expect(page.getByRole('tooltip')).toHaveText('Add to workflow');
    else {
      await expect(page.locator('.catalog-help-scope')).toHaveAttribute('data-disabled', '');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    }
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tooltip', { name: 'Add to workflow', exact: true })).toHaveCount(0);
});

Then('a multi-schema workflow restores through bounded model requests', async function () {
  const { operations } = await import('../../src/lib/catalog.ts');
  const selected = ['demo', 'httpbin'].flatMap(schema => operations.filter(operation => operation.id.startsWith(`${schema}:`) && !operation.unavailableReason).slice(0, 8));
  assert.ok(selected.length > 8);
  const document = { version: 3, id: 'batch-restore', name: 'Batched workflow', nodes: selected.map((operation, index) => ({
    id: `operation-${index}`, type: 'operation', position: { x: index * 320, y: 0 }, data: {
      operationId: operation.id, name: operation.name, description: operation.description ?? '', method: operation.method, path: operation.path,
    },
  })), edges: [], viewport: { x: 0, y: 0, zoom: 0.5 }, snap: true, curved: true, dashed: true };
  await this.page.evaluate(() => {
    const nativePost = Worker.prototype.postMessage;
    globalThis.__modelBatches = [];
    Worker.prototype.postMessage = function (message, ...args) {
      if (['model', 'models'].includes(message?.method)) globalThis.__modelBatches.push({ method: message.method, args: message.args });
      return nativePost.call(this, message, ...args);
    };
  });
  await this.page.getByLabel('Import workflow file', { exact: true }).setInputFiles({ name: 'batch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(this.page.locator('.svelte-flow__node-operation')).toHaveCount(selected.length);
  await expect(this.page.locator('.workflow-error')).toHaveCount(0);
  const requests = await this.page.evaluate(() => globalThis.__modelBatches);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.method === 'models' && request.args[2].length <= 16));
  assert.deepEqual(requests.flatMap(request => request.args[2]).sort(), selected.map(operation => operation.id).sort());
  await this.attach(JSON.stringify({ operations: selected.length, requests: requests.map(request => ({ schema: request.args[0], operations: request.args[2].length })) }), 'application/json');
});

Then('closed settings and search retain no inactive controls or matching worker', async function () {
  const { observeMatchingTransfers } = await import('./schema-profile.fixture.mjs');
  const { closeCatalog, setMode } = await import('./workspace.steps.mjs');
  await this.context.addInitScript(observeMatchingTransfers);
  const page = this.page;
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  const hiddenInputs = page.locator('.settings-section .disclosure-panel input');
  await expect(hiddenInputs).toHaveCount(0);
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  await schemas.click();
  await expect(page.locator('[data-schema-id]')).toHaveCount(descriptors.length + bundledCatalogs.length);
  const name = await page.locator('[data-schema-id="openai"] .schema-name-label').textContent();
  await schemas.click();
  await expect(page.locator('[data-schema-id]')).toHaveCount(0);
  await expect(hiddenInputs).toHaveCount(0);
  await schemas.click();
  await expect(page.locator('[data-schema-id="openai"] .schema-name-label')).toHaveText(name);
  await openCatalog(page);
  await expect(hiddenInputs).toHaveCount(0);
  await searchOperations(page, 'get');
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const live = await page.evaluate(() => globalThis.__matchingTransfers);
  assert.equal(live.workers - live.terminations, 1);
  await prompt.fill('');
  await expect.poll(() => page.evaluate(() => globalThis.__matchingTransfers.workers - globalThis.__matchingTransfers.terminations)).toBe(0);
  await searchOperations(page, 'get');
  await closeCatalog(page);
  await expect.poll(() => page.evaluate(() => globalThis.__matchingTransfers.workers - globalThis.__matchingTransfers.terminations)).toBe(0);
  const created = await page.evaluate(() => globalThis.__matchingTransfers.workers);
  await openCatalog(page);
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'get');
  assert.equal(await page.evaluate(() => globalThis.__matchingTransfers.workers), created, 'Reopening unchanged results needs no worker or scoring.');
  await expect(page.locator('[data-operation-id]')).toHaveCount(5);
  // Hidden-source changes invalidate cached results before reopening the menu.
  await setMode(page, 'settings');
  await page.locator('[data-schema-id="frankfurter"]').getByRole('switch').click();
  await expect(page.locator('[data-schema-id="frankfurter"]').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await openCatalog(page);
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'get');
  assert.equal(await page.evaluate(() => globalThis.__matchingTransfers.workers), created + 1);
});
