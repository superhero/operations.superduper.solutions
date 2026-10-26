// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, searchOperations } from './workspace.fixture.mjs';
import { paneStateKey } from '../../src/lib/pane-state.ts';

const menu = page => page.locator('.site-header [aria-controls="side-navigation"]');
const settings = page => page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
const navigation = page => page.locator('#side-navigation');
const drawer = page => page.locator('#settings-panel');
const section = (page, label) => drawer(page).locator(`summary[aria-label=${JSON.stringify(label)}]`);
const branch = (page, label) => navigation(page).locator('summary').filter({ has: page.getByText(label, { exact: true }) });
const scrollAt = async (element, position) => {
  await expect.poll(() => element.evaluate(node => node.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).length)).toBe(0);
  const value = await element.evaluate((node, position) => { node.scrollTop = position; return node.scrollTop; }, position);
  assert.ok(value > 0, 'The test must preserve an actual scrolled reading position.');
  return value;
};
const expectScroll = (element, position) => expect.poll(async () => Math.abs(await element.evaluate(node => node.scrollTop) - position)).toBeLessThan(1);

Then('refreshing restores pane widths branches settings sections and scroll positions', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1920, height: 620 });
  await openCatalog(page);
  await branch(page, 'Example.Com').click();
  await branch(page, 'Response Examples').click();
  await branch(page, 'Projects').click();
  await navigation(page).getByText('Workflows', { exact: true }).click();
  await settings(page).click();
  await section(page, 'Theme').click();
  await page.getByRole('separator', { name: 'Navigation pane width', exact: true }).press('Shift+ArrowRight');
  await page.getByRole('separator', { name: 'Settings pane width', exact: true }).press('Shift+ArrowRight');
  const leftScroll = await scrollAt(navigation(page), 160);
  const rightScroll = await scrollAt(drawer(page), 420);
  // Reload immediately: the page-hide flush must include the latest scroll events.
  await page.reload();
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(settings(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('separator', { name: 'Navigation pane width', exact: true })).toHaveAttribute('aria-valuenow', '384');
  await expect(page.getByRole('separator', { name: 'Settings pane width', exact: true })).toHaveAttribute('aria-valuenow', '836');
  await expect(branch(page, 'Projects')).toHaveAttribute('aria-expanded', 'true');
  await expect(branch(page, 'Workflows')).toHaveAttribute('aria-expanded', 'true');
  await expect(section(page, 'Theme')).toHaveAttribute('aria-expanded', 'true');
  await expectScroll(navigation(page), leftScroll);
  await expectScroll(drawer(page), rightScroll);
  await menu(page).click();
  await settings(page).click();
  await page.reload();
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(settings(page)).toHaveAttribute('aria-expanded', 'false');
  await menu(page).click();
  await settings(page).click();
  await expect(branch(page, 'Projects')).toHaveAttribute('aria-expanded', 'true');
  await expect(section(page, 'Theme')).toHaveAttribute('aria-expanded', 'true');
  await expectScroll(navigation(page), leftScroll);
  await expectScroll(drawer(page), rightScroll);
  // A new compact view shares the saved profile but cannot show both panes.
  await menu(page).click();
  await menu(page).click();
  await page.reload();
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(settings(page)).toHaveAttribute('aria-expanded', 'true');
  await page.close();
  const compact = await this.context.newPage();
  this.page = compact;
  compact.on('pageerror', error => this.diagnostics.push({ type: 'pageerror', message: error.message }));
  await compact.setViewportSize({ width: 390, height: 620 });
  await compact.goto(this.baseURL);
  await expect(menu(compact)).toHaveAttribute('aria-expanded', 'true');
  await expect(settings(compact)).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation(compact)).toHaveAttribute('data-slot', 'sheet-content');
  await compact.setViewportSize({ width: 1920, height: 620 });
  await expect(compact.getByRole('separator', { name: 'Navigation pane width', exact: true })).toHaveAttribute('aria-valuenow', '384');
  await settings(compact).click();
  await expect(compact.getByRole('separator', { name: 'Settings pane width', exact: true })).toHaveAttribute('aria-valuenow', '836');
});

Then('refreshing restores a search and its collapsed branches without losing the browse tree', async function () {
  const page = this.page;
  await openCatalog(page);
  await branch(page, 'Example.Com').click();
  await branch(page, 'Response Examples').click();
  await branch(page, 'Projects').click();
  await searchOperations(page, 'Example array response');
  await expect(branch(page, 'Response Examples')).toHaveAttribute('aria-expanded', 'true');
  await branch(page, 'Response Examples').click();
  await expect(branch(page, 'Response Examples')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation(page).getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Example array response');
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'Example array response');
  await expect(branch(page, 'Response Examples')).toHaveAttribute('aria-expanded', 'false');
  await searchOperations(page, '');
  await expect(branch(page, 'Response Examples')).toHaveAttribute('aria-expanded', 'true');
  await expect(branch(page, 'Projects')).toHaveAttribute('aria-expanded', 'true');
});

Then('compact Settings and Navigation resume after refresh without obscuring their content', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 620 });
  if (await menu(page).getAttribute('aria-expanded') === 'true') {
    await navigation(page).getByRole('button', { name: 'Close navigation', exact: true }).tap();
    await expect(navigation(page)).toHaveCount(0);
  }
  await settings(page).tap();
  await section(page, 'Theme').tap();
  const rightScroll = await scrollAt(drawer(page), 360);
  await page.reload();
  await expect(settings(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(section(page, 'Theme')).toHaveAttribute('aria-expanded', 'true');
  await expectScroll(drawer(page), rightScroll);
  await page.getByRole('button', { name: 'Close settings', exact: true }).tap();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  await branch(page, 'Example.Com').tap();
  await branch(page, 'Response Examples').tap();
  const scroller = navigation(page).locator('.catalog-scroll');
  const leftScroll = await scrollAt(scroller, 160);
  await page.reload();
  await expect(settings(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation(page)).toHaveAttribute('data-slot', 'sheet-content');
  await expect(branch(page, 'Response Examples')).toHaveAttribute('aria-expanded', 'true');
  await expectScroll(scroller, leftScroll);
  const header = await navigation(page).locator('.catalog-gesture-header').boundingBox();
  const content = await scroller.boundingBox();
  assert.ok(content.y >= header.y + header.height, 'The resumed catalog must stay below its dismissal grip.');
});

Then('invalid saved pane state falls back to valid interface defaults', async function () {
  const page = this.page;
  await page.addInitScript(key => {
    const value = sessionStorage.getItem('pane-state-test-seed');
    if (value !== null) { localStorage.setItem(key, value); sessionStorage.removeItem('pane-state-test-seed'); }
  }, paneStateKey);
  for (const snapshot of ['{', JSON.stringify({ version: 1, navigationOpen: true, settingsOpen: false,
    navigation: { prompt: 17, catalogPath: 'bad', scrollTop: -42 }, settings: { section: 'missing', scrollTop: null } })]) {
    await page.evaluate(value => sessionStorage.setItem('pane-state-test-seed', value), snapshot);
    await page.reload();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(settings(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(navigation(page).getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('');
    await expectScroll(navigation(page), 0);
  }
});
