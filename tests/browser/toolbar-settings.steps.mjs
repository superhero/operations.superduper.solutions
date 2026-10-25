// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { toolbarButtonLabels, toolbarButtonGroups, defaultToolbarButtons } from '../../src/lib/toolbar-settings.ts';
import { setMode, workflow } from './workspace.fixture.mjs';

Then('toolbar visibility choices persist and leave keyboard shortcuts available', async function () {
  const page = this.page;
  const toolbar = workflow(page).locator('.workflow-toolbar');
  await setMode(page, 'settings');
  if (await page.locator('summary[aria-label="Application"]').getAttribute('aria-expanded') !== 'true')
    await page.locator('summary[aria-label="Application"]').click();
  let preferences = page.getByRole('group', { name: 'Toolbar button preferences', exact: true });
  await expect(page.locator('summary[aria-label="Toolbar"]')).toHaveCount(0);
  await expect(page.locator('summary[aria-label="Application"]').locator('..').getByRole('group', { name: 'Toolbar button preferences', exact: true })).toBeVisible();
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
    const toggle = preferences.getByRole('switch', { name: `Show ${label} toolbar button`, exact: true });
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
  if (await page.locator('summary[aria-label="Application"]').getAttribute('aria-expanded') !== 'true')
    await page.locator('summary[aria-label="Application"]').click();
  preferences = page.getByRole('group', { name: 'Toolbar button preferences', exact: true });
  await expect(preferences.getByRole('switch', { checked: false })).toHaveCount(labels.length);
  await expect(preferences.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);
  for (const label of labels) await preferences.getByRole('switch', { name: `Show ${label} toolbar button`, exact: true }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('button')).toHaveCount(labels.length);
  await expect(toolbar.locator('.workflow-control-group')).toHaveCount(7);
});

Then('application preferences adapt and balance cards as the pane is resized', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1600, height: 1400 });
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Application"]').click();
  const preferences = page.getByRole('group', { name: 'UI defaults', exact: true });
  const cards = preferences.locator('[data-application-setting]');
  const resize = page.getByRole('separator', { name: 'Settings pane width', exact: true });
  const boxes = () => cards.evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
  }));
  await expect(cards).toHaveCount(6);
  const artifactDirectory = this.artifactDirectory;
  async function inspect(columns, name) {
    await expect.poll(async () => new Set((await boxes()).map(box => Math.round(box.x))).size).toBe(columns);
    await expect.poll(async () => {
      const positions = await boxes();
      return positions.every((box, index) => positions.slice(index + 1).every(other =>
        box.x + box.width <= other.x + 1 || other.x + other.width <= box.x + 1 ||
        box.y + box.height <= other.y + 1 || other.y + other.height <= box.y + 1));
    }).toBe(true);
    for (const card of await cards.all()) {
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await preferences.locator('xpath=../..').screenshot({ path: `${artifactDirectory}/application-settings-${name}.png` });
  }
  await inspect(3, 'wide');
  const clearance = await preferences.locator('[data-application-setting="nodeClearance"]').boundingBox();
  const snap = await preferences.locator('[data-application-setting="snap"]').boundingBox();
  expect(Math.abs(snap.x - clearance.x)).toBeLessThan(2);
  await resize.press('Home');
  await resize.press('Shift+ArrowLeft');
  await resize.press('Shift+ArrowLeft');
  await resize.press('ArrowLeft');
  await expect(resize).toHaveAttribute('aria-valuenow', '504');
  await inspect(2, 'medium');
  const toggle = preferences.getByRole('switch', { name: 'Node symbols', exact: true });
  const checked = await toggle.getAttribute('aria-checked'); await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(checked !== 'true'));
  await resize.press('Home');
  await inspect(1, 'narrow');
  await expect(toggle).toHaveAttribute('aria-checked', String(checked !== 'true'));
});
