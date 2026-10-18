// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode } from './workspace.steps.mjs';

const browserSection = page => page.locator('.settings-section').filter({ has: page.locator('summary[aria-label="Browser"]') });
Then('Browser settings show a compact building status before the dashboard with {string} motion', async function (motion) {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: motion });
  await setMode(page, 'settings');
  const section = browserSection(page);
  await expect(section.locator('.storage-dashboard')).toHaveCount(0);
  await page.evaluate(() => {
    window.browserBuildFrames = [];
    const sample = () => {
      const section = document.querySelector('summary[aria-label="Browser"]').parentElement;
      const panel = section.querySelector(':scope > .disclosure-panel');
      const building = section.querySelector('.storage-building');
      const dashboard = section.querySelector('.storage-dashboard');
      if (building && panel.getBoundingClientRect().height > 10)
        window.browserBuildFrames.push({ height: panel.getBoundingClientRect().height, dashboard: !!dashboard });
      if (!dashboard) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await section.locator('summary').first().click();
  await expect(section.locator('.storage-dashboard')).toBeVisible();
  await expect(section.locator('.storage-building')).toHaveCount(0);
  const frames = await page.evaluate(() => window.browserBuildFrames);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(frame => !frame.dashboard && frame.height < 100)).toBe(true);
  await expect.poll(() => section.locator(':scope > .disclosure-panel').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(100);
  // Subsequent opens reuse the already constructed view.
  await section.locator('summary').first().click();
  await section.locator('summary').first().click();
  await expect(section.locator('.storage-dashboard')).toBeVisible();
  await expect(section.locator('.storage-building')).toHaveCount(0);
});
Then('closing Browser before construction leaves it unbuilt until reopened', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setMode(page, 'settings');
  const section = browserSection(page);
  // Switch sections after Svelte flushes the open state, before its first paint.
  await section.locator('summary').first().evaluate(el => {
    el.click();
    queueMicrotask(() => document.querySelector('summary[aria-label="Application"]').click());
  });
  await expect(section.locator('summary').first()).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(section.locator('.storage-dashboard')).toHaveCount(0);
  await section.locator('summary').first().click();
  await expect(section.locator('.storage-dashboard')).toBeVisible();
});
