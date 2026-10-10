// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.steps.mjs';
import { closeWorkflowDetails, workflowNameInput } from './workflow-details.fixture.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const disabledDefaults = { dashed: false, curved: false, snap: false, gridSize: 12 };
const enabledDefaults = { dashed: true, curved: true, snap: true, gridSize: 12 };
const settingLabels = { dashed: 'Dashed lines', curved: 'Curved lines', snap: 'Snap to grid' };
const toolbarLabels = { dashed: 'Dashed connections', curved: 'Curved connections', snap: 'Snap to grid' };
const settings = page => page.getByRole('region', { name: 'Settings workspace', exact: true });
const summary = (page, name) => settings(page).locator(`summary[aria-label="${name}"]`);
const options = ({ dashed, curved, snap }) => ({ dashed, curved, snap });

export async function storedDefaults(page, change) {
  return page.evaluate(({ write, change }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('operations-preferences-v1');
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
  if (await summary(page, 'Workflow').getAttribute('aria-expanded') !== 'true') await summary(page, 'Workflow').click();
  await expect(summary(page, 'Workflow')).toHaveAttribute('aria-expanded', 'true');
}

async function expectDefaultSwitches(page, defaults) {
  for (const [key, label] of Object.entries(settingLabels))
    await expect(settings(page).getByRole('switch', { name: label, exact: true })).toHaveAttribute('aria-checked', String(defaults[key]));
  await expect(settings(page).getByRole('spinbutton', { name: 'Grid size', exact: true })).toHaveValue(String(defaults.gridSize));
}

export async function setWorkflowGridSize(page, gridSize) {
  await openDefaults(page);
  const control = settings(page).getByRole('spinbutton', { name: 'Grid size', exact: true });
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
  for (const name of ['Theme', 'Workflow', 'Storage', 'Workflow']) {
    await summary(page, name).click();
    for (const section of ['Theme', 'Workflow', 'Storage'])
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
      if (this.name === 'operations-preferences-v1' && mode === 'readwrite') throw new Error('Settings save temporarily unavailable');
      return window.settingsOriginalTransaction.call(this, stores, mode, ...rest);
    };
  });
  await settings(page).getByRole('switch', { name: 'Dashed lines', exact: true }).click();
  await expect(settings(page).getByRole('alert')).toContainText('Could not save workflow defaults');
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
    { stored: { ...disabledDefaults, gridSize: 97 }, expected: disabledDefaults },
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
