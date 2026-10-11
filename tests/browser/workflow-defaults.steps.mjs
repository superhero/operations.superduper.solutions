// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.steps.mjs';
import { closeWorkflowDetails, workflowNameInput } from './workflow-details.fixture.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const disabledDefaults = { dashed: false, curved: false, snap: false, gridSize: 12, dashGap: 4, curveStrength: 50 };
const enabledDefaults = { dashed: true, curved: true, snap: true, gridSize: 12, dashGap: 4, curveStrength: 50 };
const settingLabels = { dashed: 'Dashed lines', curved: 'Curved lines', snap: 'Snap to grid' };
const toolbarLabels = { dashed: 'Dashed connections', curved: 'Curved connections', snap: 'Snap to grid' };
const settings = page => page.getByRole('region', { name: 'Settings workspace', exact: true });
const summary = (page, name) => settings(page).locator(`summary[aria-label="${name}"]`);
const options = ({ dashed, curved, snap }) => ({ dashed, curved, snap });

export async function storedDefaults(page, change) {
  return page.evaluate(({ write, change }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('settings', write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('settings');
      if (write) store.put(change, 'workflowDefaults');
      const value = store.get('workflowDefaults');
      transaction.oncomplete = () => { database.close(); resolve(value.result); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), { write: arguments.length > 1, change });
}

async function openDefaults(page) {
  await setMode(page, 'settings');
  if (await summary(page, 'Workflows').getAttribute('aria-expanded') !== 'true') await summary(page, 'Workflows').click();
  await expect(summary(page, 'Workflows')).toHaveAttribute('aria-expanded', 'true');
}

async function expectDefaultSwitches(page, defaults) {
  for (const [key, label] of Object.entries(settingLabels))
    await expect(settings(page).getByRole('switch', { name: label, exact: true })).toHaveAttribute('aria-checked', String(defaults[key]));
  await expect(settings(page).getByRole('textbox', { name: 'Grid size value', exact: true })).toHaveValue(String(defaults.gridSize));
  await expect(settings(page).getByRole('slider', { name: 'Grid size', exact: true })).toHaveAttribute('aria-valuenow', String(defaults.gridSize));
  await expect(settings(page).getByRole('textbox', { name: 'Dash gap value', exact: true })).toHaveValue(String(defaults.dashGap));
  await expect(settings(page).getByRole('slider', { name: 'Dash gap', exact: true })).toHaveAttribute('aria-valuenow', String(defaults.dashGap));
  await expect(settings(page).getByRole('textbox', { name: 'Curve strength value', exact: true })).toHaveValue(String(defaults.curveStrength));
  await expect(settings(page).getByRole('slider', { name: 'Curve strength', exact: true })).toHaveAttribute('aria-valuenow', String(defaults.curveStrength));
}

export async function setWorkflowGridSize(page, gridSize) {
  await openDefaults(page);
  const control = settings(page).getByRole('textbox', { name: 'Grid size value', exact: true });
  await control.fill(String(gridSize));
  await control.press('Tab');
  await expect(control).toHaveValue(String(gridSize));
  await expect.poll(async () => (await storedDefaults(page)).gridSize).toBe(gridSize);
}

async function setDefaults(page, defaults) {
  await openDefaults(page);
  for (const [key, label] of Object.entries(settingLabels)) {
    const control = settings(page).getByRole('switch', { name: label, exact: true });
    if (await control.getAttribute('aria-checked') !== String(defaults[key])) await control.click();
  }
  await expectDefaultSwitches(page, defaults);
  await expect.poll(() => storedDefaults(page)).toEqual(defaults);
}

async function expectWorkflowOptions(page, defaults) {
  for (const [key, label] of Object.entries(toolbarLabels))
    await expect(workflow(page).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', String(defaults[key]));
}

async function newWorkflow(page) {
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await expect(workflowNameInput(page)).toBeFocused();
  await closeWorkflowDetails(page);
}

Then('Settings sections open exclusively and workflow defaults start disabled', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  for (const name of ['Theme', 'Workflows', 'Browser', 'Workflows']) {
    await summary(page, name).click();
    for (const section of ['Theme', 'Workflows', 'Browser'])
      await expect(summary(page, section)).toHaveAttribute('aria-expanded', String(section === name));
  }
  await expectDefaultSwitches(page, disabledDefaults);
});

When('I enable all workflow defaults', async function () {
  await setDefaults(this.page, enabledDefaults);
});

When('workflow defaults recover after a failed settings save', async function () {
  const page = this.page;
  await page.evaluate(() => {
    window.settingsOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (this.name === 'v1/settings' && mode === 'readwrite') throw new Error('Settings save temporarily unavailable');
      return window.settingsOriginalTransaction.call(this, stores, mode, ...rest);
    };
  });
  await settings(page).getByRole('switch', { name: 'Dashed lines', exact: true }).click();
  await expect(settings(page).getByRole('alert')).toContainText('Could not save workflow defaults');
  const expectedFailure = item => item.type === 'console-error' && item.message.includes('SettingsStorageError')
    && item.message.includes('Settings save temporarily unavailable');
  await expect.poll(() => this.diagnostics.filter(expectedFailure).length).toBe(1);
  this.diagnostics = this.diagnostics.filter(item => !expectedFailure(item));
  assert.deepEqual(await storedDefaults(page), enabledDefaults);
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = window.settingsOriginalTransaction;
    delete window.settingsOriginalTransaction;
  });
  await settings(page).getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(settings(page).getByRole('alert')).toHaveCount(0);
  await expect.poll(() => storedDefaults(page)).toEqual({ ...enabledDefaults, dashed: false });
  await setDefaults(page, enabledDefaults);
  await page.screenshot({ path: 'tmp/test/workflow-defaults.png' });
});

Then('the defaults survive reload and initialize untouched and new workflows', async function () {
  const page = this.page;
  await page.reload();
  await openDefaults(page);
  await expectDefaultSwitches(page, enabledDefaults);
  await setMode(page, 'workflow');
  await expectWorkflowOptions(page, enabledDefaults);
  assert.deepEqual(await storedWorkflows(page), [], 'Applying defaults must not save an untouched canvas.');
  await newWorkflow(page);
  await expectWorkflowOptions(page, enabledDefaults);
  assert.deepEqual(await storedWorkflows(page), [], 'Creating an untouched workflow must not create a saved document.');
  await workflow(page).getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(page.locator(".site-header .document-meta").getByText('Saved locally', { exact: true })).toBeVisible();
  assert.deepEqual(options((await storedWorkflows(page))[0]), options(enabledDefaults));
});

Then('workflow options remain independent from the saved defaults', async function () {
  const page = this.page;
  const original = { dashed: false, curved: false, snap: true };
  await setMode(page, 'workflow');
  await workflow(page).getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await workflow(page).getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(page.locator(".site-header .document-meta").getByText('Saved locally', { exact: true })).toBeVisible();
  const saved = (await storedWorkflows(page))[0];
  const history = await repository(page, 'history', saved.id);
  assert.deepEqual(options(saved), original);
  await setDefaults(page, enabledDefaults);
  await setMode(page, 'workflow');
  await expectWorkflowOptions(page, original);
  assert.deepEqual(await repository(page, 'history', saved.id), history, 'Changing defaults must not version an existing workflow.');
  await page.reload();
  await setMode(page, 'workflow');
  await expectWorkflowOptions(page, original);
  await newWorkflow(page);
  await expectWorkflowOptions(page, enabledDefaults);
  await workflow(page).getByRole('button', { name: 'Dashed connections', exact: true }).click();
  await expect(page.locator(".site-header .document-meta").getByText('Saved locally', { exact: true })).toBeVisible();
  assert.deepEqual(await storedDefaults(page), enabledDefaults, 'Toolbar changes must only change the current workflow.');
  await setDefaults(page, disabledDefaults);
  await setMode(page, 'workflow');
  await expectWorkflowOptions(page, { ...enabledDefaults, dashed: false });
  const importedOptions = { dashed: true, curved: false, snap: true };
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({ name: 'own-options.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 3, id: 'import-own-options', name: 'Imported options', description: '', nodes: [], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }, ...importedOptions })) });
  await expectWorkflowOptions(page, importedOptions);
  assert.deepEqual(options((await readExport(page)).document), importedOptions);
  assert.deepEqual(await storedDefaults(page), disabledDefaults);
  assert.deepEqual(options((await storedWorkflows(page)).find(document => document.id === saved.id)), original);
});

Then('invalid workflow defaults retain valid booleans and safely reset other fields', async function () {
  const cases = [
    { stored: { dashed: 'yes', curved: 1, snap: true }, expected: { ...disabledDefaults, snap: true } },
    { stored: { dashed: true, curved: true, snap: null, gridSize: 0, extra: true }, expected: { ...enabledDefaults, snap: false } },
    { stored: { ...disabledDefaults, gridSize: 33 }, expected: disabledDefaults },
    { stored: { ...disabledDefaults, gridSize: 12.5 }, expected: disabledDefaults },
    { stored: { ...disabledDefaults, gridSize: '18' }, expected: disabledDefaults },
    { stored: 'invalid workflow defaults', expected: disabledDefaults },
  ];
  for (const { stored, expected } of cases) {
    await storedDefaults(this.page, stored);
    await this.page.reload();
    await openDefaults(this.page);
    await expectDefaultSwitches(this.page, expected);
    assert.deepEqual(await storedDefaults(this.page), expected, 'Loading invalid defaults must persist their normalized values.');
    await setMode(this.page, 'workflow');
    await expectWorkflowOptions(this.page, expected);
    assert.deepEqual(await storedWorkflows(this.page), []);
  }
});

Then('the grid size slider supports exact keys and saves its nonlinear pointer value across reload', async function () {
  const page = this.page;
  await openDefaults(page);
  const slider = settings(page).getByRole('slider', { name: 'Grid size', exact: true });
  const input = settings(page).getByRole('textbox', { name: 'Grid size value', exact: true });
  await expect(slider).toHaveAttribute('aria-valuemin', '1');
  await expect(slider).toHaveAttribute('aria-valuemax', '32');
  await expect(input).toHaveValue('12');
  for (const [key, value] of [['Home', 1], ['ArrowLeft', 1], ['End', 32], ['ArrowRight', 32], ['ArrowLeft', 31]]) {
    await slider.press(key);
    await expect(slider).toHaveAttribute('aria-valuenow', String(value));
    await expect(input).toHaveValue(String(value));
  }
  await expect.poll(async () => (await storedDefaults(page)).gridSize).toBe(31);
  await input.fill('33');
  await input.press('Tab');
  await expect(input).toHaveValue('33');
  assert.equal((await storedDefaults(page)).gridSize, 31, 'An out-of-range draft must not replace the saved grid size.');
  await input.fill('16');
  await input.press('Tab');
  await expect.poll(async () => (await storedDefaults(page)).gridSize).toBe(16);
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  assert.ok(bounds, 'The grid size slider must provide a pointer target.');
  const samples = [];
  for (const fraction of [0.1, 0.2, 0.45, 0.55, 0.8, 0.9]) {
    await page.mouse.click(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2);
    const value = Number(await slider.getAttribute('aria-valuenow'));
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 32);
    samples.push(value);
  }
  assert.ok(samples.every((value, index) => index === 0 || value > samples[index - 1]),
    `Pointer values must increase monotonically: ${samples.join(', ')}.`);
  const centerChange = samples[3] - samples[2];
  assert.ok(centerChange > samples[1] - samples[0] && centerChange > samples[5] - samples[4],
    `Equal pointer distances must change more integers near the center: ${samples.join(', ')}.`);
  for (let index = 0; index < samples.length / 2; index++) {
    assert.ok(Math.abs(samples[index] + samples[samples.length - 1 - index] - 33) <= 1,
      `Equally offset pointer values must remain symmetric around the range midpoint: ${samples.join(', ')}.`);
  }
  const selected = samples.at(-1);
  await expect.poll(async () => (await storedDefaults(page)).gridSize).toBe(selected);
  await page.screenshot({ path: 'tmp/test/integer-slider-grid-size.png' });
  await page.reload();
  await openDefaults(page);
  await expect(input).toHaveValue(String(selected));
  await expect(slider).toHaveAttribute('aria-valuenow', String(selected));
});
