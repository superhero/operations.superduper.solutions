// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, setMode, workspace } from './workspace.steps.mjs';

async function pauseNextAnimation(page, selector, property) {
  // Observe before the input action: transport and locator waits can otherwise
  // outlast a short transition when the full browser suite is busy.
  await page.evaluate(({ selector, property }) => {
    const element = document.querySelector(selector);
    const deadline = performance.now() + 5000;
    window.__testAnimationObserved = new Promise(resolve => {
      let observed = false;
      const sample = () => {
        if (observed) return;
        const animation = element.getAnimations().find(item =>
          item.effect.getKeyframes().some(frame => property in frame));
        if (animation) {
          observed = true;
          element.removeEventListener('transitionrun', sample);
          animation.pause();
          animation.currentTime = animation.effect.getTiming().duration / 2;
          resolve(true);
        } else if (performance.now() < deadline) requestAnimationFrame(sample);
        else {
          element.removeEventListener('transitionrun', sample);
          resolve(false);
        }
      };
      element.addEventListener('transitionrun', sample);
      requestAnimationFrame(sample);
    });
  }, { selector, property });
  return async () => {
    const observed = await page.evaluate(async () => {
      const result = await window.__testAnimationObserved;
      delete window.__testAnimationObserved;
      return result;
    });
    assert.ok(observed, `The ${property} animation must run after the input action.`);
  };
}

Then('prompt focus and navigation hover animate and settle with the motion preference', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const promptRing = page.locator('.catalog-prompt .prompt-input');
  await openCatalog(page);
  const menu = page.getByRole('button', { name: 'Close navigation', exact: true });
  await menu.focus();
  await expect.poll(() => promptRing.evaluate(element => element.getAnimations().length)).toBe(0);
  const focusing = await pauseNextAnimation(page, '.catalog-prompt .prompt-input', 'outlineColor');
  await prompt.focus();
  await focusing();
  const focusMotion = await promptRing.evaluate(element => {
    const animation = element.getAnimations().find(item => item.transitionProperty === 'outline-color');
    if (!animation) return null;
    animation.pause();
    animation.currentTime = animation.effect.getTiming().duration / 2;
    return { color: getComputedStyle(element).outlineColor, frames: animation.effect.getKeyframes().map(frame => frame.outlineColor) };
  });
  assert.ok(focusMotion, 'Prompt focus should fade in, rather than appear abruptly.');
  assert.ok(focusMotion.frames.every(color => color !== focusMotion.color), 'The focus outline should have a visible intermediate color.');
  const hovering = await pauseNextAnimation(page, '.menu-button', 'transform');
  await menu.hover();
  await hovering();
  await expect.poll(() => menu.evaluate(element => element.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => menu.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expect.poll(() => promptRing.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(prompt).toBeFocused();
  await expect(promptRing).toHaveCSS('outline-style', 'solid');
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
  const disclosure = report.locator('.schema-disclosure > .disclosure-panel');
  const json = report.locator('.schema-disclosure .json-view');
  await expect(json).toBeVisible();
  await expect.poll(() => disclosure.evaluate(element => element.getAnimations().length)).toBe(0);
  const closingMotion = await pauseNextAnimation(page, '[aria-label="Operation report"] .schema-disclosure > .disclosure-panel', 'height');
  await header.press('Enter');
  await closingMotion();
  const closing = await disclosure.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    content: element.querySelector('.json-view')?.getBoundingClientRect().height,
  }));
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
  await expect(workspace(page)).toBeVisible();
  await expect.poll(() => workspace(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#run-operation-details')).toHaveCSS('transition-property', 'grid-template-rows, visibility');
  await expect.poll(() => page.locator('#run-operation-details').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
});

Then('native scrollbars expand on hover and settle without changing the reading position', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await page.setViewportSize({ width: 1280, height: 360 });
  const heading = page.getByRole('region', { name: 'Settings workspace', exact: true }).locator('summary[aria-label="Workflows"]');
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  await page.evaluate(() => window.scrollTo(0, 0));
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
  const leavingMotion = await pauseNextAnimation(page, 'html', '--scrollbar-y-inset');
  await page.mouse.move(640, 160);
  await leavingMotion();
  const halfwayInset = await inset();
  assert.ok(halfwayInset > 0 && halfwayInset < 4, 'The scrollbar thumb must interpolate while leaving hover.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(inset).toBe(4);
  await expect.poll(() => root.evaluate(element => element.getAnimations().length)).toBe(0);
  assert.equal(await page.evaluate(() => scrollY), before, 'Thumb feedback must not scroll the document or change its geometry.');
  await page.mouse.move(1280 - metrics.width / 2, 160);
  await expect.poll(inset).toBe(0);
  await expect.poll(() => root.evaluate(element => element.getAnimations().length)).toBe(0);
});
