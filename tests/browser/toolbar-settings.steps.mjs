// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { toolbarButtonLabels } from '../../src/lib/toolbar-settings.ts';
import { setMode, workflow } from './workspace.steps.mjs';

Then('toolbar visibility choices persist and leave keyboard shortcuts available', async function () {
  const page = this.page;
  const toolbar = workflow(page).locator('.workflow-toolbar');
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Buttons"]').click();
  let preferences = page.getByRole('group', { name: 'Toolbar button preferences', exact: true });
  const labels = Object.values(toolbarButtonLabels).sort((left, right) => left.localeCompare(right));
  await expect(preferences.getByRole('switch')).toHaveText(labels);
  for (const [key, label] of Object.entries(toolbarButtonLabels)) {
    const toggle = preferences.getByRole('switch', { name: label, exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
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
  await page.locator('summary[aria-label="Buttons"]').click();
  preferences = page.getByRole('group', { name: 'Toolbar button preferences', exact: true });
  await expect(preferences.getByRole('switch', { checked: false })).toHaveCount(labels.length);
  await preferences.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('button')).toHaveCount(labels.length);
  await expect(toolbar.locator('.workflow-control-group')).toHaveCount(7);
});
