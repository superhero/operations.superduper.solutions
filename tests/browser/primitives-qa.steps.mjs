// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog, workspace, searchOperations, setEvaluationDetails, openThemeSettings } from './workspace.steps.mjs';
import { holdHeightAnimations, resumeHeightAnimations, seekHeightAnimation } from './height-animation.fixture.mjs';

Then('navigation focus follows normal-motion opening and breakpoint changes', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await closeCatalog(page);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  const mode = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await expect(mode).toBeFocused();
  await closeCatalog(page);
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(mode).toBeFocused();
  await page.setViewportSize({ width: 899, height: 900 });
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-slot="sheet-content"]')))).toBe(true);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(mode).toBeFocused();
});

Then('expanding a nested catalog item does not clip its parent', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCatalog(page);
  const group = page.locator('[data-catalog-group="projects"] > .catalog-group');
  const panel = group.locator(':scope > .disclosure-panel');
  const child = group.locator('[data-catalog-group="overview"] > .catalog-group');
  const childPanel = child.locator(':scope > .disclosure-panel');
  const restoreParent = await holdHeightAnimations(panel);
  let restoreChild;
  try {
    await group.locator(':scope > summary').press('Enter');
    await expect.poll(() => panel.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
    const parentFrame = await seekHeightAnimation(panel, 0.5);
    assert.ok(parentFrame.running && parentFrame.to > parentFrame.from, 'The parent must still be opening.');
    restoreChild = await holdHeightAnimations(childPanel);
    await child.locator(':scope > summary').press('Enter');
    await expect.poll(() => childPanel.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
    const frames = [];
    let maximumOverflow = 0;
    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      frames.push(await seekHeightAnimation(childPanel, progress));
      // The child clips its own list while opening; its ancestor must fit the
      // changing child height and all following siblings throughout that motion.
      const overflow = await group.evaluate(element => {
        const parentPanel = element.querySelector(':scope > .disclosure-panel');
        const content = parentPanel.querySelector(':scope > .catalog-children');
        return content.getBoundingClientRect().bottom - parentPanel.getBoundingClientRect().bottom;
      });
      maximumOverflow = Math.max(maximumOverflow, overflow);
    }
    assert.ok(frames.every(frame => frame.running && frame.to > frame.from), 'Containment must be sampled while the nested group is opening.');
    assert.ok(frames.some(frame => frame.height > frame.from + 1 && frame.height < frame.to - 1),
      'The nested group must reach an intermediate height.');
    assert.ok(maximumOverflow <= 1, `The parent clipped growing nested content by ${maximumOverflow}px.`);
    await resumeHeightAnimations(childPanel);
    await expect.poll(() => group.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    const finalChildOverflow = await childPanel.evaluate(element =>
      element.querySelector('.catalog-operations').getBoundingClientRect().bottom - element.getBoundingClientRect().bottom);
    assert.ok(finalChildOverflow <= 1, `The expanded child clipped its operation list by ${finalChildOverflow}px.`);
    await restoreChild();
    restoreChild = undefined;
    await group.locator(':scope > summary').press('Enter');
    await expect.poll(() => panel.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
    const closingFrame = await seekHeightAnimation(panel, 0.5);
    assert.ok(closingFrame.running && closingFrame.from > closingFrame.to, 'Closing an expanded child must preserve the parent close animation.');
    await resumeHeightAnimations(panel);
    await expect(panel).toBeHidden();
  } finally {
    await restoreChild?.();
    await restoreParent();
  }
});

Then('hovering another control replaces keyboard help', async function () {
  const page = this.page;
  await openThemeSettings(page);
  await page.getByRole('switch', { name: 'Dark theme', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('tooltip')).toHaveText('Switch to dark theme');
  await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Settings');
  await expect(page.getByRole('tooltip')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  const close = page.locator('[data-slot="sheet-content"]').getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('tooltip')).toHaveText('Close navigation');
  await expect(close).toHaveAccessibleName('Close');
  await close.press('Enter');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

Then('prompt matching details preserve keyboard navigation', async function () {
  const page = this.page;
  await setEvaluationDetails(page);
  await page.setViewportSize({ width: 280, height: 844 });
  await openCatalog(page);
  const tooltip = page.getByRole('tooltip');
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const toggle = page.getByRole('button', { name: 'Review matching details', exact: true });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await searchOperations(page, 'List projects');
  await expect(prompt).toBeFocused();
  await prompt.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(tooltip).toHaveText('Details');
  await expect(toggle).not.toHaveAttribute('title');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#matching-help')).toBeVisible();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.press('Tab');
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue('List projects');
  await expect(page.getByRole('button', { name: 'Add to workflow: List projects', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Progress', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  if (await page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Operation catalog', exact: true }) }).isVisible()) await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

Then('schema action hints take priority over the disclosure hint', async function () {
  const page = this.page;
  const tooltip = page.getByRole('tooltip');
  await page.getByRole('button', { name: 'Review operation details', exact: true }).click();
  const header = page.getByRole('region', { name: 'Operation JSON schema', exact: true }).locator('summary[aria-label="OpenAPI schema"]');
  await header.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(0, 0);
  await header.hover();
  await expect(tooltip).toHaveText('Show OpenAPI schema');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(0, 0);
  await header.hover();
  await expect(tooltip).toHaveText('Hide OpenAPI schema');
  for (const name of ['Copy JSON', 'Wrap lines']) {
    const action = header.getByRole('button', { name, exact: true });
    await action.hover();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toHaveText(name);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
  }
  const wrap = header.getByRole('button', { name: 'Wrap lines', exact: true });
  const wrapped = await wrap.getAttribute('aria-pressed');
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', String(wrapped !== 'true'));
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(0, 0);
  await header.focus();
  for (const name of ['Copy JSON', 'Wrap lines']) {
    await page.keyboard.press('Tab');
    await expect(header.getByRole('button', { name, exact: true })).toBeFocused();
    await expect(tooltip).toHaveText(name);
    await expect(tooltip).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(wrap).toBeFocused();
});

Then('scrolling cancels a pending operation tooltip', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 400 });
  const dialog = workspace(page);
  const help = page.getByRole('button', { name: 'Review operation details', exact: true });
  await help.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await help.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Details');
  await page.mouse.move(600, 300);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // Let the shared provider's skip-delay grace period expire before the hover.
  await page.waitForTimeout(400);
  await help.hover();
  await page.waitForTimeout(100);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const before = await dialog.evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, 150);
  await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  // Observe beyond the 400ms hover delay; an immediate absence would miss this bug.
  await page.waitForTimeout(450);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

Then('settings scroll independently of the main header', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 400 });
  const section = page.getByRole('region', { name: 'Settings workspace', exact: true }).locator('summary[aria-label="Application"]');
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
  const header = page.locator('.site-header');
  const before = await header.boundingBox();
  const drawer = page.locator('.settings-drawer');
  await drawer.evaluate(element => element.scrollTo(0, 150));
  await expect.poll(() => drawer.evaluate(element => element.scrollTop)).toBe(150);
  assert.deepEqual(await header.boundingBox(), before);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await expect.poll(async () => Math.round((await section.boundingBox()).y)).toBe(Math.round((await drawer.boundingBox()).y));
});
