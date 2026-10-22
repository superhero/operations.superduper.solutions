// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Reusable browser helpers; importing this module registers no steps or hooks.
import { toggleConnectionStyle, chooseSettingsLineStyle } from './connection-style.fixture.mjs';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.fixture.mjs';
import { closeWorkflowDetails, workflowNameInput } from './workflow-details.fixture.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';
import { createUtilityNode } from '../../src/lib/workflow-graph.ts';

const freshDefaults = { dashed: true, curved: false, snap: true, nodeSymbols: true, gridSize: 8, dashLength: 8, dashGap: 16, dashSpeed: 64, curveStrength: 100, nodeClearance: 16 };

const disabledDefaults = { lineStyle: 'orthogonal', dashed: false, curved: false, snap: false, gridSize: 12, dashLength: 6, dashGap: 4, dashSpeed: 20, curveStrength: 50, nodeClearance: 12, nodeSymbols: true };

const enabledDefaults = { lineStyle: 'filleted', dashed: true, curved: true, snap: true, gridSize: 12, dashLength: 6, dashGap: 4, dashSpeed: 20, curveStrength: 200, nodeClearance: 12, nodeSymbols: true };

const settingLabels = { dashed: 'Dashed lines', snap: 'Snap to grid', nodeSymbols: 'Node symbols' };

const toolbarLabels = { dashed: 'Dashed connections', curved: 'Connection style', snap: 'Snap to grid' };

const settings = page => page.getByRole('region', { name: 'Settings workspace', exact: true });

const summary = (page, name) => settings(page).locator(`summary[aria-label="${name}"]`);

const options = ({ dashed, curved, snap }) => ({ dashed, curved, snap });

const storedNumber = raw => raw === 'NaN' ? NaN : raw === 'Infinity' ? Infinity : JSON.parse(raw);

async function storedDefaults(page, change) {
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
  if (await summary(page, 'Application').getAttribute('aria-expanded') !== 'true') await summary(page, 'Application').click();
  await expect(summary(page, 'Application')).toHaveAttribute('aria-expanded', 'true');
}

async function expectDefaultSwitches(page, defaults) {
  await expect(settings(page).getByRole('slider', { name: 'Connection style', exact: true }))
    .toHaveAttribute('aria-valuetext', defaults.curved ? 'Filleted' : 'Orthogonal');
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

async function setWorkflowGridSize(page, gridSize) {
  await openDefaults(page);
  const control = settings(page).getByRole('textbox', { name: 'Grid size value', exact: true });
  await control.fill(String(gridSize));
  await control.press('Tab');
  await expect(control).toHaveValue(String(gridSize));
  await expect.poll(async () => (await storedDefaults(page)).gridSize).toBe(gridSize);
}

async function setWorkflowNodeClearance(page, nodeClearance) {
  await openDefaults(page);
  const control = settings(page).getByRole('textbox', { name: 'Node clearance value', exact: true });
  await control.fill(String(nodeClearance));
  await control.press('Tab');
  await expect(control).toHaveValue(String(nodeClearance));
  await expect.poll(async () => (await storedDefaults(page)).nodeClearance).toBe(nodeClearance);
}

async function setWorkflowDashValues(page, values) {
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
  await chooseSettingsLineStyle(page, defaults.curved ? 'filleted' : 'orthogonal');
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

export { freshDefaults, disabledDefaults, enabledDefaults, settingLabels, toolbarLabels, settings, summary, options, storedNumber, storedDefaults, openDefaults, expectDefaultSwitches, setWorkflowGridSize, setWorkflowNodeClearance, setWorkflowDashValues, setDefaults, expectWorkflowOptions, newWorkflow };
