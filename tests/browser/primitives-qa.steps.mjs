// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog } from './workspace.steps.mjs';

Then('navigation focus follows normal-motion opening and breakpoint changes', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  const mode = page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Operations', exact: true });
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
  await group.locator(':scope > summary').press('Enter');
  assert.ok(await panel.evaluate(element => element.getAnimations().length > 0), 'The parent must still be opening.');
  const child = group.locator('[data-catalog-group="overview"] > .catalog-group');
  await child.locator(':scope > summary').press('Enter');
  assert.ok(await child.locator(':scope > .disclosure-panel').evaluate(element => element.getAnimations().length > 0), 'The nested group must still be opening.');
  const sample = await group.evaluate(async element => {
    const parentPanel = element.querySelector(':scope > .disclosure-panel');
    const parentContent = parentPanel.querySelector(':scope > .catalog-children');
    const childPanel = element.querySelector('[data-catalog-group="overview"] > .catalog-group > .disclosure-panel');
    const list = element.querySelector('.catalog-operations');
    let maximumOverflow = 0;
    let frames = 0;
    let animatedFrames = 0;
    do {
      await new Promise(requestAnimationFrame);
      if (childPanel.getAnimations().length) animatedFrames += 1;
      // The child clips its own list while opening; its ancestor must fit the
      // changing child height and all following siblings throughout that motion.
      maximumOverflow = Math.max(maximumOverflow, parentContent.getBoundingClientRect().bottom - parentPanel.getBoundingClientRect().bottom);
      frames += 1;
    } while (element.getAnimations({ subtree: true }).length && frames < 60);
    const finalChildOverflow = list.getBoundingClientRect().bottom - childPanel.getBoundingClientRect().bottom;
    return { maximumOverflow, finalChildOverflow, frames, animatedFrames };
  });
  assert.ok(sample.animatedFrames > 0, 'Containment must be sampled while the nested group is opening.');
  assert.ok(sample.frames < 60, 'Nested disclosure animations must settle.');
  assert.ok(sample.maximumOverflow <= 1, `The parent clipped growing nested content by ${sample.maximumOverflow}px.`);
  assert.ok(sample.finalChildOverflow <= 1, `The expanded child clipped its operation list by ${sample.finalChildOverflow}px.`);
  await group.locator(':scope > summary').press('Enter');
  assert.ok(await panel.evaluate(element => element.getAnimations().length > 0), 'Closing an expanded child must preserve the parent close animation.');
  await expect(panel).toBeHidden();
});

Then('hovering another control replaces keyboard help', async function () {
  const page = this.page;
  await openCatalog(page);
  await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tooltip')).toHaveText('Switch to dark theme');
  await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Workflows', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Workflows');
  await expect(page.getByRole('tooltip')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const close = page.locator('[data-slot="sheet-content"]').getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Close navigation');
  await expect(close).toHaveAccessibleName('Close');
  await close.press('Enter');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

Then('progress hints and examples preserve navigation and disabled states', async function () {
  const page = this.page;
  const tooltip = page.getByRole('tooltip');
  const progress = page.getByRole('navigation', { name: 'Progress', exact: true });
  const promptStep = progress.getByRole('button', { name: '1. Prompt', exact: true });
  const evaluation = progress.getByRole('button', { name: '2. Evaluation', exact: true });
  const operation = progress.getByRole('button', { name: '3. Operation', exact: true });
  const input = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await expect(progress.locator('.step-label:visible')).toHaveCount(3);
  await promptStep.hover();
  // Observe beyond the provider's hover delay: visible labels need no tooltip.
  await page.waitForTimeout(450);
  await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 0);
  await input.focus();
  await input.press('Shift+Tab');
  await expect(promptStep).toBeFocused();
  await expect(tooltip).toHaveCount(0);

  await page.setViewportSize({ width: 280, height: 844 });
  await expect(progress.locator('.step-number:visible')).toHaveCount(3);
  await promptStep.hover();
  await expect(tooltip).toHaveText('Prompt');
  await page.mouse.move(0, 0);
  await input.focus();
  await input.press('Shift+Tab');
  await expect(promptStep).toBeFocused();
  await expect(tooltip).toHaveText('Prompt');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);

  for (const [button, hint] of [[evaluation, 'Search for operations to view the evaluation'], [operation, 'Select an operation to open its inputs']]) {
    await expect(button).toBeDisabled();
    assert.equal(await button.evaluate(element => element.disabled), true, 'Unavailable steps must retain native disabled behavior.');
    await button.hover();
    await expect(tooltip).toHaveText(hint);
    assert.equal(await button.getAttribute('title'), null, 'Custom help must not duplicate a native title tooltip.');
    const bounds = await button.boundingBox();
    assert.ok(bounds);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(promptStep).toHaveAttribute('aria-current', 'step');
    await promptStep.focus();
    await button.evaluate(element => element.focus());
    await expect(promptStep).toBeFocused();
  }
  await page.mouse.move(0, 0);
  await promptStep.press('Tab');
  await expect(input).toBeFocused();

  const example = page.locator('.prompt-suggestion-list').getByRole('button', { name: 'List projects', exact: true });
  await example.hover();
  await page.waitForTimeout(450);
  await expect(tooltip).toHaveCount(0);
  await expect(example).toHaveAccessibleName('List projects');
  await example.click();
  await expect(input).toHaveValue('List projects');
  await expect(input).toBeFocused();
  await expect(evaluation).toBeDisabled();
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Evaluation: Listed operations', exact: true })).toBeFocused();
  await evaluation.focus();
  await expect(tooltip).toHaveText('Evaluation');
  await expect(evaluation).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Go to operation: List projects', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toBeFocused();
  await evaluation.focus();
  await evaluation.press('Tab');
  await expect(operation).toBeFocused();
  await expect(tooltip).toHaveText('Operation');
  await expect(operation).toHaveAttribute('aria-current', 'step');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(progress.locator('.step-label:visible')).toHaveCount(3);
  await expect(tooltip).toHaveCount(0);
  await expect(operation).toBeEnabled();
  await expect(operation).toHaveAttribute('aria-current', 'step');
});

Then('schema action hints take priority over the disclosure hint', async function () {
  const page = this.page;
  const tooltip = page.getByRole('tooltip');
  await page.getByRole('button', { name: 'Review operation details', exact: true }).click();
  const header = page.locator('summary[aria-label="OpenAPI schema"]');
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
  const help = page.getByRole('button', { name: 'Review operation details', exact: true });
  await help.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await help.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Details');
  await page.mouse.move(600, 300);
  await page.keyboard.press('Escape');
  // Let the shared provider's skip-delay grace period expire before the hover.
  await page.waitForTimeout(400);
  await help.hover();
  await page.waitForTimeout(100);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 150);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  // Observe beyond the 400ms hover delay; an immediate absence would miss this bug.
  await page.waitForTimeout(450);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

Then('the header shadow follows the reading position', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 400 });
  const header = page.locator('.site-header');
  const strength = () => header.evaluate(element => Number(getComputedStyle(element).getPropertyValue('--header-scroll-strength')));
  const opacity = () => header.evaluate(element => {
    const context = document.createElement('canvas').getContext('2d');
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] / 255;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(strength).toBe(0);
  await expect.poll(opacity).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 40));
  await expect.poll(strength).toBeGreaterThan(0);
  assert.ok(await strength() < 1, 'The header shadow must strengthen progressively before 80px.');
  assert.ok(await opacity() > 0 && await opacity() < 1, 'The header surface must fade in without appearing abruptly.');
  await page.evaluate(() => window.scrollTo(0, 80));
  await expect.poll(strength).toBe(1);
  await expect.poll(opacity).toBe(1);
});
