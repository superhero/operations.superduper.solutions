// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

Then('prompt focus and navigation hover animate and settle with the motion preference', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menu.focus();
  await expect.poll(() => prompt.evaluate(element => element.getAnimations().length)).toBe(0);
  await prompt.focus();
  const focusMotion = await prompt.evaluate(element => {
    const animation = element.getAnimations().find(item => item.transitionProperty === 'outline-color');
    if (!animation) return null;
    animation.pause();
    animation.currentTime = animation.effect.getTiming().duration / 2;
    return { color: getComputedStyle(element).outlineColor, frames: animation.effect.getKeyframes().map(frame => frame.outlineColor) };
  });
  assert.ok(focusMotion, 'Prompt focus should fade in, rather than appear abruptly.');
  assert.ok(focusMotion.frames.every(color => color !== focusMotion.color), 'The focus outline should have a visible intermediate color.');
  await menu.hover();
  await expect.poll(() => menu.evaluate(element => element.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => menu.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expect.poll(() => prompt.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveCSS('outline-style', 'solid');
  await expect(menu).toHaveCSS('transform', 'none');
});

Then('report and schema transitions retain content through interruption', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const reportButton = page.getByRole('button', { name: 'Review operation details', exact: true });
  await reportButton.click();
  const report = page.getByRole('region', { name: 'Operation report', exact: true });
  const header = report.locator('summary[aria-label="OpenAPI schema"]');
  await header.click();
  const disclosure = page.locator('.schema-disclosure > .disclosure-panel');
  const json = page.locator('.schema-disclosure .json-view');
  await expect(json).toBeVisible();
  await expect.poll(() => disclosure.evaluate(element => element.getAnimations().length)).toBe(0);
  await header.press('Enter');
  const closing = await disclosure.evaluate(element => {
    const animation = element.getAnimations().find(item => item.effect.getKeyframes().some(frame => 'height' in frame));
    if (!animation) return null;
    animation.pause();
    animation.currentTime = animation.effect.getTiming().duration / 2;
    return { height: element.getBoundingClientRect().height, content: element.querySelector('.json-view')?.getBoundingClientRect().height };
  });
  assert.ok(closing?.height > 0 && closing.content > 0, 'Collapsing the schema must retain visible JSON until the panel closes.');
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => disclosure.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(json).toBeVisible();
  await expect.poll(() => disclosure.evaluate(element => element.clientHeight >= element.querySelector('.json-view').getBoundingClientRect().height - 1)).toBe(true);
  await reportButton.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(report).toHaveCount(0);
  await reportButton.click();
  await expect(report).toBeVisible();
  await expect.poll(() => report.evaluate(element => element.parentElement.getAnimations({ subtree: true }).length)).toBe(0);
});

Then('native scrollbars expand on hover and settle without changing the reading position', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const root = page.locator('html');
  const inset = () => root.evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--scrollbar-y-inset')));
  const metrics = await root.evaluate(element => ({ width: innerWidth - element.clientWidth, scrollable: element.scrollHeight > element.clientHeight, height: element.scrollHeight, viewport: element.clientHeight, enhanced: element.classList.contains('animated-scrollbars') }));
  assert.ok(metrics.scrollable && metrics.width > 0, `The native scrollbar must have a real scrollable document and hit area: ${JSON.stringify(metrics)}`);
  await page.mouse.move(1280 - metrics.width / 2, 160);
  await expect.poll(inset).toBe(0);
  await page.mouse.wheel(0, 50);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.move(640, 160);
  await expect.poll(() => root.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(inset).toBe(4);
  await expect.poll(() => root.evaluate(element => element.getAnimations().length)).toBe(0);
  assert.equal(await page.evaluate(() => scrollY), before, 'Thumb feedback must not scroll the document or change its geometry.');
  await page.mouse.move(1280 - metrics.width / 2, 160);
  await expect.poll(inset).toBe(0);
  await expect.poll(() => root.evaluate(element => element.getAnimations().length)).toBe(0);
});
