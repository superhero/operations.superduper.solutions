// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { toolbarButtonLabels, toolbarButtonGroups, defaultToolbarButtons } from '../../src/lib/toolbar-settings.ts';
import { setMode, workflow } from './workspace.steps.mjs';

Then('toolbar visibility choices persist and leave keyboard shortcuts available', async function () {
  const page = this.page;
  const toolbar = workflow(page).locator('.workflow-toolbar');
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Toolbar"]').click();
  let preferences = page.getByRole('group', { name: 'Toolbar button preferences', exact: true });
  const labels = toolbarButtonGroups.flatMap(group => group.buttons.map(key => toolbarButtonLabels[key]));
  await expect(preferences.getByRole('switch')).toHaveText(labels);
  await expect.poll(() => preferences.locator('.groups').evaluate(element => Number(getComputedStyle(element).columnCount))).toBe(3);
  for (const group of toolbarButtonGroups) {
    const card = preferences.getByRole('group', { name: group.label, exact: true });
    const box = await card.boundingBox();
    const title = await card.getByRole('heading', { name: group.label, exact: true }).boundingBox();
    expect(title.y).toBeGreaterThanOrEqual(box.y + 8);
    expect(title.y + title.height).toBeLessThan(box.y + box.height);
    await expect(preferences.getByRole('group', { name: group.label, exact: true }).getByRole('switch')).toHaveCount(group.buttons.length);
  }
  for (const [key, label] of Object.entries(toolbarButtonLabels)) {
    const toggle = preferences.getByRole('switch', { name: label, exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', String(defaultToolbarButtons[key]));
    if (defaultToolbarButtons[key]) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const buttonName = key === 'zoomIn' ? 'Zoom In' : key === 'zoomOut' ? 'Zoom Out' : label;
    await expect(toolbar.getByRole('button', { name: buttonName, exact: true })).toHaveCount(0);
  }
  await expect(toolbar).toHaveCount(0);
  // Hiding the toolbar must not disable the action behind its keyboard shortcut.
  await workflow(page).focus();
  await page.keyboard.press('Control+h');
  const history = page.getByRole('dialog', { name: 'Workflow history', exact: true });
  await expect(history).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await page.reload();
  await setMode(page, 'workflow');
  await expect(toolbar).toHaveCount(0);
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Toolbar"]').click();
  preferences = page.getByRole('group', { name: 'Toolbar button preferences', exact: true });
  await expect(preferences.getByRole('switch', { checked: false })).toHaveCount(labels.length);
  await expect(preferences.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);
  for (const label of labels) await preferences.getByRole('switch', { name: label, exact: true }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('button')).toHaveCount(labels.length);
  await expect(toolbar.locator('.workflow-control-group')).toHaveCount(7);
});

Then('application preferences use three independent lanes', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Application"]').click();
  const lanes = page.getByRole('group', { name: 'UI defaults', exact: true }).locator('.application-lane');
  await expect(lanes).toHaveCount(3);
  const boxes = await Promise.all((await lanes.all()).map(lane => lane.boundingBox()));
  expect(new Set(boxes.map(box => Math.round(box.x))).size).toBe(3);
  expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThan(2);
  for (const lane of await lanes.all()) await expect(lane.locator('.workflow-default-pair')).toHaveCount(2);
});
