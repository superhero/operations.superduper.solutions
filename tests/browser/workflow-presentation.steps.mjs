// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

Then('graph selection feedback remains distinct in the {string} theme', async function (theme) {
  const page = this.page;
  await openCatalog(page);
  const dark = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await dark.getAttribute('aria-checked') !== String(theme === 'dark')) await dark.click();
  await closeCatalog(page);
  const selected = page.locator('.operation-node.selected');
  await expect(selected).toHaveCount(1);
  const border = await selected.evaluate(element => getComputedStyle(element).borderColor);
  await selected.hover();
  await expect(selected).toHaveCSS('border-color', border);
  await page.locator('.svelte-flow__node.selected').focus();
  await expect(selected).toHaveCSS('border-color', border);

  const snap = page.getByRole('button', { name: 'Snap to grid', exact: true });
  const paint = () => snap.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  await page.mouse.move(0, 0);
  const unpressed = await paint();
  await snap.hover();
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  const pressed = await paint();
  await expectThemeColors(snap, { backgroundColor: '--color-catalog-active', color: '--color-catalog-active-foreground' });
  assert.notDeepEqual(pressed, unpressed, 'Selection must remain visibly different from the idle control.');
  await page.mouse.move(0, 0);
  assert.deepEqual(await paint(), pressed, 'Leaving the selected control must preserve its selected appearance.');
  await snap.focus();
  assert.deepEqual(await paint(), pressed, 'Keyboard focus must preserve the selected appearance.');
  await page.keyboard.press('Space');
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.svelte-flow__node.selected').focus();
  await page.mouse.move(0, 0);
  assert.deepEqual(await paint(), unpressed, 'Turning the option off and leaving it must restore its idle appearance.');
});
