// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog } from './workspace.fixture.mjs';

async function savedWidth(page, key, width) {
  await expect.poll(() => page.evaluate(key => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('settings', 'readonly');
      const value = transaction.objectStore('settings').get(key);
      transaction.oncomplete = () => { database.close(); resolve(value.result); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), key), { message: `${key} must be persisted before reloading.` }).toBe(width);
}

Then('resizing Settings changes when the catalog closes and Settings becomes fullscreen', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openCatalog(page);
  const menu = page.locator('.site-header [aria-controls="side-navigation"]');
  const settings = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  const drawer = page.locator('#settings-panel');
  const grip = page.getByRole('separator', { name: 'Settings pane width', exact: true });
  await settings.click();
  await expect(grip).toHaveAttribute('aria-valuenow', '900');
  const from = await grip.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 100);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 300, from.y + 100, { steps: 15 });
  await page.mouse.up();
  await expect(grip).toHaveAttribute('aria-valuenow', '600');
  await expect.poll(async () => Math.round((await drawer.boundingBox()).width)).toBe(600);
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  // The resized pane fits until 1420px, rather than the old fixed 1720px.
  await page.setViewportSize({ width: 1419, height: 900 });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer).not.toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 899, height: 900 });
  await expect(page.getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
  await expect.poll(async () => Math.round((await drawer.boundingBox()).width)).toBe(899);
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(grip).toHaveAttribute('aria-valuenow', '600');
  await expect.poll(async () => Math.round((await drawer.boundingBox()).width)).toBe(600);
  await grip.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(grip).toHaveAttribute('aria-valuenow', '616');
  await savedWidth(page, 'settingsPaneWidth', 616);
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(grip).toHaveAttribute('aria-valuenow', '616');
  // A wider chosen pane becomes fullscreen at a correspondingly wider viewport.
  await page.setViewportSize({ width: 1920, height: 1000 });
  await grip.focus();
  await page.keyboard.press('End');
  await expect(grip).toHaveAttribute('aria-valuenow', '1440');
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
  await expect.poll(async () => Math.round((await drawer.boundingBox()).width)).toBe(1600);
});

Then('the left menu resizes from its right edge without becoming narrower than 320 pixels', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openCatalog(page);
  const catalog = page.locator('#side-navigation');
  const grip = page.getByRole('separator', { name: 'Navigation pane width', exact: true });
  const settings = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  await expect(grip).toHaveAttribute('aria-valuemin', '320');
  await expect(grip).toHaveAttribute('aria-valuenow', '320');
  const from = await grip.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 100);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 160, from.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect(grip).toHaveAttribute('aria-valuenow', '480');
  await expect.poll(async () => Math.round((await catalog.boundingBox()).width)).toBe(480);
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await grip.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(grip).toHaveAttribute('aria-valuenow', '544');
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await savedWidth(page, 'navigationPaneWidth', 544);
  await page.reload();
  // Stored widths render before startup removes the app's inert state.
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(grip).toHaveAttribute('aria-valuenow', '544');
  await grip.focus();
  await expect(grip).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(grip).toHaveAttribute('aria-valuenow', '320');
  await page.keyboard.press('End');
  await expect(grip).toHaveAttribute('aria-valuenow', '1440');
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(async () => Math.round((await catalog.boundingBox()).width)).toBe(750);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(grip).toHaveAttribute('aria-valuenow', '1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(catalog).toHaveAttribute('data-slot', 'sheet-content');
  await expect(grip).toHaveCount(0);
  await expect.poll(async () => Math.round((await catalog.boundingBox()).width)).toBe(320);
});
