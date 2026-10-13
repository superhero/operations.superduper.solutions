// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.steps.mjs';
import { closeWorkflowDetails, workflowNameInput } from './workflow-details.fixture.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const freshDefaults = { dashed: true, curved: false, snap: true, nodeSymbols: true, gridSize: 8, dashLength: 8, dashGap: 16, dashSpeed: 64, curveStrength: 50, nodeClearance: 16 };
const disabledDefaults = { dashed: false, curved: false, snap: false, gridSize: 12, dashLength: 6, dashGap: 4, dashSpeed: 20, curveStrength: 50, nodeClearance: 12, nodeSymbols: true };
const enabledDefaults = { dashed: true, curved: true, snap: true, gridSize: 12, dashLength: 6, dashGap: 4, dashSpeed: 20, curveStrength: 50, nodeClearance: 12, nodeSymbols: true };
const settingLabels = { dashed: 'Dashed lines', curved: 'Curved lines', snap: 'Snap to grid', nodeSymbols: 'Node symbols' };
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
  for (const [key, label] of [['dashLength', 'Dash length'], ['dashSpeed', 'Dash speed']]) {
    await expect(settings(page).getByRole('textbox', { name: `${label} value`, exact: true })).toHaveValue(String(defaults[key]));
    await expect(settings(page).getByRole('slider', { name: label, exact: true })).toHaveAttribute('aria-valuenow', String(defaults[key]));
  }
  await expect(settings(page).getByRole('textbox', { name: 'Curve strength value', exact: true })).toHaveValue(String(defaults.curveStrength));
  await expect(settings(page).getByRole('slider', { name: 'Curve strength', exact: true })).toHaveAttribute('aria-valuenow', String(defaults.curveStrength));
  await expect(settings(page).getByRole('textbox', { name: 'Node clearance value', exact: true })).toHaveValue(String(defaults.nodeClearance));
  await expect(settings(page).getByRole('slider', { name: 'Node clearance', exact: true })).toHaveAttribute('aria-valuenow', String(defaults.nodeClearance));
}

export async function setWorkflowGridSize(page, gridSize) {
  await openDefaults(page);
  const control = settings(page).getByRole('textbox', { name: 'Grid size value', exact: true });
  await control.fill(String(gridSize));
  await control.press('Tab');
  await expect(control).toHaveValue(String(gridSize));
  await expect.poll(async () => (await storedDefaults(page)).gridSize).toBe(gridSize);
}

export async function setWorkflowNodeClearance(page, nodeClearance) {
  await openDefaults(page);
  const control = settings(page).getByRole('textbox', { name: 'Node clearance value', exact: true });
  await control.fill(String(nodeClearance));
  await control.press('Tab');
  await expect(control).toHaveValue(String(nodeClearance));
  await expect.poll(async () => (await storedDefaults(page)).nodeClearance).toBe(nodeClearance);
}

export async function setWorkflowDashValues(page, values) {
  await openDefaults(page);
  for (const [key, label] of [['dashLength', 'Dash length'], ['dashGap', 'Dash gap'], ['dashSpeed', 'Dash speed']]) {
    if (values[key] === undefined) continue;
    const control = settings(page).getByRole('textbox', { name: `${label} value`, exact: true });
    await control.fill(String(values[key]));
    await control.press('Tab');
    await expect(control).toHaveValue(String(values[key]));
    await expect.poll(async () => (await storedDefaults(page))[key]).toBe(values[key]);
  }
}

async function setDefaults(page, defaults) {
  await openDefaults(page);
  for (const [key, label] of Object.entries(settingLabels)) {
    const control = settings(page).getByRole('switch', { name: label, exact: true });
    if (await control.getAttribute('aria-checked') !== String(defaults[key])) await control.click();
  }
  for (const [key, label] of [['gridSize', 'Grid size'], ['dashLength', 'Dash length'], ['dashGap', 'Dash gap'],
    ['dashSpeed', 'Dash speed'], ['curveStrength', 'Curve strength'], ['nodeClearance', 'Node clearance']]) {
    const input = settings(page).getByRole('textbox', { name: `${label} value`, exact: true });
    if (await input.inputValue() === String(defaults[key])) continue;
    await input.fill(String(defaults[key]));
    await input.press('Tab');
    await expect.poll(async () => (await storedDefaults(page))[key]).toBe(defaults[key]);
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

Then('Settings sections open exclusively with the current workflow defaults in a fresh browser', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  for (const name of ['Theme', 'Workflows', 'Browser', 'Workflows']) {
    await summary(page, name).click();
    for (const section of ['Theme', 'Workflows', 'Browser'])
      await expect(summary(page, section)).toHaveAttribute('aria-expanded', String(section === name));
  }
  await expectDefaultSwitches(page, freshDefaults);
  assert.deepEqual(await storedDefaults(page), freshDefaults);
  await setMode(page, 'workflow');
  await expectWorkflowOptions(page, freshDefaults);
  await newWorkflow(page);
  await expectWorkflowOptions(page, freshDefaults);
  assert.deepEqual(await storedWorkflows(page), [], 'Fresh defaults must initialize untouched and new canvases without saving either.');
});

When('I save different workflow defaults', async function () {
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
  for (const [key, label] of Object.entries(toolbarLabels)) {
    const toggle = workflow(page).getByRole('button', { name: label, exact: true });
    if (await toggle.getAttribute('aria-pressed') !== String(original[key])) await toggle.click();
  }
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
    { stored: { dashed: 'yes', curved: 1, snap: true }, expected: freshDefaults },
    { stored: { dashed: true, curved: true, snap: null, gridSize: 0, extra: true, nodeSymbols: 'false' }, expected: { ...freshDefaults, curved: true } },
    { stored: { ...disabledDefaults, gridSize: 33, nodeSymbols: false }, expected: { ...disabledDefaults, gridSize: 8, nodeSymbols: false } },
    { stored: { ...disabledDefaults, gridSize: 12.5 }, expected: { ...disabledDefaults, gridSize: 8 } },
    { stored: { ...disabledDefaults, gridSize: '18' }, expected: { ...disabledDefaults, gridSize: 8 } },
    { stored: 'invalid workflow defaults', expected: freshDefaults },
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
  await expect(input).toHaveValue('8');
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

Given('workflow defaults saved with node clearance {word}', async function (raw) {
  this.nodeClearanceDefaults = { ...disabledDefaults, dashed: true, snap: true,
    gridSize: 27, dashGap: 6, curveStrength: 71 };
  const stored = { ...this.nodeClearanceDefaults };
  if (raw === 'missing') delete stored.nodeClearance;
  else stored.nodeClearance = raw === 'NaN' ? NaN : raw === 'Infinity' ? Infinity : JSON.parse(raw);
  await storedDefaults(this.page, stored);
});

When('Settings reloads the saved node clearance', async function () {
  await this.page.reload();
  await openDefaults(this.page);
});

Then('node clearance is {int} and the other saved workflow defaults are preserved', async function (nodeClearance) {
  const expected = { ...this.nodeClearanceDefaults, nodeClearance };
  await expectDefaultSwitches(this.page, expected);
  await expect.poll(() => storedDefaults(this.page)).toEqual(expected);
  assert.deepEqual(await storedWorkflows(this.page), [], 'Normalizing a browser setting must not create workflow documents.');
});

Then('node clearance enforces its bounds and survives reload without saving a workflow', async function () {
  const page = this.page;
  await openDefaults(page);
  const slider = settings(page).getByRole('slider', { name: 'Node clearance', exact: true });
  const input = settings(page).getByRole('textbox', { name: 'Node clearance value', exact: true });
  await expect(slider).toHaveAttribute('aria-valuemin', '0');
  await expect(slider).toHaveAttribute('aria-valuemax', '128');
  await expect(input).toHaveValue('16');
  for (const invalid of ['-1', '129', '12.5', 'not-a-number', '']) {
    await input.fill(invalid);
    await input.press('Tab');
    await expect(settings(page).getByRole('alert')).toContainText('Node clearance must be a whole number from 0 to 128.');
    assert.equal((await storedDefaults(page)).nodeClearance, 16, 'Invalid drafts must leave the persisted clearance intact.');
  }
  for (const value of [0, 128, 24]) {
    await setWorkflowNodeClearance(page, value);
    await expect(slider).toHaveAttribute('aria-valuenow', String(value));
    await expect(settings(page).getByRole('alert')).toHaveCount(0);
  }
  for (const [key, value] of [['Home', 0], ['ArrowLeft', 0], ['End', 128], ['ArrowRight', 128], ['ArrowLeft', 127]]) {
    await slider.press(key);
    await expect(input).toHaveValue(String(value));
    await expect(slider).toHaveAttribute('aria-valuenow', String(value));
  }
  await expect.poll(() => storedDefaults(page)).toEqual({ ...freshDefaults, nodeClearance: 127 });
  await page.reload();
  await openDefaults(page);
  await expectDefaultSwitches(page, { ...freshDefaults, nodeClearance: 127 });
  assert.deepEqual(await storedWorkflows(page), [], 'Saving clearance must not save an untouched workflow.');
});

Then('missing and malformed dash settings preserve each other and the remaining workflow defaults', async function () {
  const page = this.page, retained = { ...disabledDefaults, dashed: true, nodeSymbols: false, gridSize: 27, dashGap: 9 };
  const cases = [
    { patch: {}, missing: ['dashLength', 'dashSpeed'], length: 8, speed: 64 },
    { patch: { dashSpeed: 31 }, missing: ['dashLength'], length: 8, speed: 31 },
    { patch: { dashLength: 17 }, missing: ['dashSpeed'], length: 17, speed: 64 },
    { patch: { dashLength: 1, dashSpeed: 0 }, length: 1, speed: 0 },
    { patch: { dashLength: 128, dashSpeed: 512 }, length: 128, speed: 512 },
    { patch: { dashLength: '18', dashSpeed: 31 }, length: 8, speed: 31 },
    { patch: { dashLength: 17, dashSpeed: -1 }, length: 17, speed: 64 },
    { patch: { dashLength: 0, dashSpeed: 513 }, length: 8, speed: 64 },
    { patch: { dashLength: 1.5, dashSpeed: NaN }, length: 8, speed: 64 },
  ];
  for (const { patch, missing = [], length, speed } of cases) {
    const stored = { ...retained, ...patch };
    for (const key of missing) delete stored[key];
    await storedDefaults(page, stored);
    await page.reload();
    await openDefaults(page);
    const expected = { ...retained, dashLength: length, dashSpeed: speed };
    await expectDefaultSwitches(page, expected);
    assert.deepEqual(await storedDefaults(page), expected, 'Each dash setting must normalize without resetting independent preferences.');
  }
  assert.deepEqual(await storedWorkflows(page), [], 'Normalizing dash preferences must not save an untouched workflow.');
});

Then('dash length and speed controls reject invalid drafts and persist their independent limits', async function () {
  const page = this.page;
  await openDefaults(page);
  for (const [key, label, minimum, maximum, initial] of [['dashLength', 'Dash length', 1, 128, 8], ['dashSpeed', 'Dash speed', 0, 512, 64]]) {
    const input = settings(page).getByRole('textbox', { name: `${label} value`, exact: true });
    const slider = settings(page).getByRole('slider', { name: label, exact: true });
    await expect(slider).toHaveAttribute('aria-valuemin', String(minimum));
    await expect(slider).toHaveAttribute('aria-valuemax', String(maximum));
    for (const invalid of [String(minimum - 1), String(maximum + 1), '12.5', 'not-a-number', '']) {
      await input.fill(invalid);
      await input.press('Tab');
      await expect(settings(page).getByRole('alert')).toContainText(`${label} must be a whole number from ${minimum} to ${maximum}.`);
      assert.equal((await storedDefaults(page))[key], initial, 'An invalid dash draft must not replace its saved value.');
    }
    await setWorkflowDashValues(page, { [key]: 18 });
    await expect(settings(page).getByRole('alert')).toHaveCount(0);
    for (const [pressed, value] of [['Home', minimum], ['ArrowLeft', minimum], ['End', maximum], ['ArrowRight', maximum]]) {
      await slider.press(pressed);
      await expect(input).toHaveValue(String(value));
      await expect(slider).toHaveAttribute('aria-valuenow', String(value));
      await expect.poll(async () => (await storedDefaults(page))[key]).toBe(value);
    }
  }
  await setWorkflowDashValues(page, { dashLength: 18, dashSpeed: 0 });
  const expected = { ...freshDefaults, dashLength: 18, dashSpeed: 0 };
  await expect.poll(() => storedDefaults(page)).toEqual(expected);
  await page.reload();
  await openDefaults(page);
  await expectDefaultSwitches(page, expected);
  assert.deepEqual(await storedWorkflows(page), [], 'Changing dash preferences must not save an untouched workflow.');
});

Then('the Node symbols preference hides existing node headings and footers across reload and restores them independently of actions', async function () {
  const page = this.page;
  const value = { id: 'code', label: 'Code', type: 'Text', required: false, description: '', connectable: true };
  const document = { version: 3, id: 'node-symbols-review', name: 'Node symbols review', description: '',
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false,
    nodes: [
      { id: 'symbols-operation', type: 'operation', position: { x: 400, y: 200 },
        data: { operationId: 'demo:listProjects', name: 'Symbol operation', description: '', method: 'GET', path: '/projects' } },
      ...['inputs', 'outputs'].map(direction => ({ id: `symbols-${direction}`, type: 'data', position: { x: direction === 'inputs' ? 40 : 760, y: 200 },
        data: { ownerId: 'symbols-operation', direction, label: direction === 'inputs' ? 'Symbol input' : 'Symbol output', fields: [value] } })),
      { id: 'symbols-switch', type: 'switch', position: { x: 400, y: 430 }, data: { gates: [{ id: 'symbols-gate', operator: 'is_set', value: '' }] } },
      { id: 'symbols-cast', type: 'cast', position: { x: 760, y: 430 }, data: { targetType: 'Text' } },
      { id: 'symbols-comment', type: 'comment', position: { x: 40, y: 430 }, data: { text: 'Symbols can be hidden without hiding actions.' } },
      { id: 'symbols-reference', type: 'workflow', position: { x: 760, y: 680 }, data: {
        workflowId: 'symbols-snapshot', name: 'Nested symbols', description: '', snapshot: {
          version: 3, id: 'symbols-snapshot', name: 'Nested symbols', description: '', nodes: [], edges: [],
          viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false,
        },
      } },
    ],
    edges: [
      { id: 'schema:symbols-inputs', kind: 'schema', source: 'symbols-inputs', sourceHandle: 'value',
        target: 'symbols-operation', targetHandle: 'schema:symbols-inputs' },
      { id: 'schema:symbols-outputs', kind: 'schema', source: 'symbols-operation', sourceHandle: 'schema:symbols-outputs',
        target: 'symbols-outputs', targetHandle: 'value' },
    ],
  };
  await setMode(page, 'workflow');
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'node-symbols.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(workflow(page).locator('.svelte-flow__node[data-id="symbols-reference"]')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  const baseline = (await readExport(page)).document;
  const versions = await repository(page, 'history', baseline.id);
  const symbols = workflow(page).locator('.operation-title-row > .material-symbols-rounded, .data-title > .material-symbols-rounded, .utility-title > .material-symbols-rounded, .workflow-kind > .material-symbols-rounded');
  const inputFooter = workflow(page).locator('.workflow-data-node[data-direction="inputs"] > .data-title > .material-symbols-rounded');
  const assertSymbols = async visible => {
    await expect(symbols).toHaveCount(7);
    await expect(inputFooter).toHaveCount(1);
    for (const symbol of await symbols.all()) {
      if (visible) await expect(symbol).toBeVisible();
      else await expect(symbol).toBeHidden();
    }
    const action = workflow(page).locator('.svelte-flow__node[data-id="symbols-switch"]').getByRole('button', { name: 'Add gate', exact: true });
    await expect(action).toBeVisible();
    await expect(action).toBeEnabled();
    await expect(action.locator('.material-symbols-rounded')).toBeVisible();
    await expect(workflow(page).getByRole('button', { name: 'Cast', exact: true }).locator('.material-symbols-rounded')).toBeVisible();
  };
  await assertSymbols(true);
  await openDefaults(page);
  const toggle = settings(page).getByRole('switch', { name: 'Node symbols', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect.poll(() => storedDefaults(page)).toEqual({ ...freshDefaults, nodeSymbols: false });
  await setMode(page, 'workflow');
  await assertSymbols(false);
  await page.reload();
  await setMode(page, 'workflow');
  await assertSymbols(false);
  await openDefaults(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect.poll(() => storedDefaults(page)).toEqual(freshDefaults);
  await setMode(page, 'workflow');
  await assertSymbols(true);
  assert.deepEqual((await readExport(page)).document, baseline, 'Node symbol visibility must remain a browser preference, preserving the existing workflow.');
  assert.deepEqual(await repository(page, 'history', baseline.id), versions, 'Hiding and restoring node symbols must not create workflow revisions.');
});
