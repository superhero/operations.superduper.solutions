// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { closeCatalog, expectFieldValue, field, openCatalog } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

Then('the focused control is visible below the sticky header', async function () {
  await expect.poll(() => this.page.evaluate(() => {
    const target = document.activeElement;
    if (!target || target === document.body || target.closest('[inert],[hidden]')) return false;
    const bounds = target.getBoundingClientRect();
    const header = document.querySelector('.site-header').getBoundingClientRect();
    return bounds.top >= header.bottom && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth;
  })).toBe(true);
});
When('I return to the form without editing', async function () {
  await this.page.getByRole('button', { name: 'Edit inputs', exact: true }).click();
});
When('I return to the prompt through progress', async function () {
  await this.page.getByRole('navigation', { name: 'Progress' }).getByRole('button', { name: /Prompt$/ }).click();
});
Then('animated form details keep the active panel contained', async function () {
  await this.page.emulateMedia({ reducedMotion: 'no-preference' });
  const samples = await this.page.evaluate(async () => {
    const panel = document.querySelector('.step-panel[aria-hidden="false"]');
    const viewport = document.querySelector('.step-viewport');
    const control = panel.querySelector('[aria-label="Review operation details"]');
    const measurements = [];
    const start = performance.now();
    control.click();
    await new Promise(resolve => {
      const sample = () => requestAnimationFrame(() => setTimeout(() => {
        const content = panel.getBoundingClientRect();
        const clip = viewport.getBoundingClientRect();
        measurements.push({ height: content.height, clipped: Math.max(0, content.bottom - clip.bottom) });
        if (performance.now() - start < 650) sample(); else resolve();
      }, 0));
      sample();
    });
    return measurements;
  });
  assert.ok(Math.max(...samples.map(sample => sample.height)) - Math.min(...samples.map(sample => sample.height)) > 40,
    'The check must observe an actual animated expansion.');
  assert.ok(samples.every(sample => sample.clipped <= 2), `Active controls were clipped during expansion: ${JSON.stringify(samples)}`);
});
When('I return to the form through progress', async function () {
  await this.page.getByRole('navigation', { name: 'Progress' }).getByRole('button', { name: /Operation$/ }).click();
});
Then('changing motion preference settles visible details immediately', async function () {
  const page = this.page;
  const details = page.locator('#operation-details');
  for (const opening of [true, false]) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Review operation details', exact: true }).click();
    await expect.poll(() => details.evaluate(element => {
      const animations = element.getAnimations().filter(animation => animation.effect.getTiming().duration > 0);
      // Slow the in-flight transition to isolate preference handling from its
      // ordinary completion, without substituting the browser's media event.
      for (const animation of animations) animation.playbackRate = 0.1;
      return animations.length;
    })).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const moving = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return (document.getElementById('operation-details')?.getAnimations() ?? [])
        .some(animation => animation.playState === 'running');
    });
    assert.equal(moving, false, 'Existing disclosure motion must finish when reduced motion is enabled.');
    if (opening) await expect(details).toBeVisible();
    else {
      await expect(details).toBeHidden();
      await expect(details.locator('.detail-report')).toHaveCount(0);
    }
    await expect(page.locator('.step-viewport')).not.toHaveClass(/\bfollowing-content-size\b/);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.step-viewport')).toHaveCSS('transition-property', 'height');
  await expect.poll(() => page.locator('.step-viewport').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
});

Then('the required Priority dropdown supports keyboard choice and cancellation', async function () {
  const page = this.page;
  const priority = await field(page, 'Priority');
  const list = page.getByRole('listbox');
  await expect(priority).toBeFocused();
  await expect(priority).toHaveAttribute('aria-required', 'true');
  await expect(priority).toHaveAttribute('aria-expanded', 'false');
  await expectFieldValue(page, 'Priority', '');
  await priority.press('Space');
  await expect(list).toBeVisible();
  await priority.press('End');
  await priority.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(priority).toBeFocused();
  await expectFieldValue(page, 'Priority', 'high');

  await priority.press('ArrowDown');
  await expect(list.getByRole('option', { name: 'high', exact: true })).toHaveAttribute('aria-selected', 'true');
  await priority.press('Home');
  await priority.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(priority).toBeFocused();
  await expectFieldValue(page, 'Priority', 'high');

  await priority.press('Space');
  await priority.press('Home');
  await priority.press('Enter');
  await expectFieldValue(page, 'Priority', '');
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  await expect(priority).toBeFocused();
  await expect(page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
  await priority.press('Space');
  await priority.press('End');
  await priority.press('Enter');
  await expectFieldValue(page, 'Priority', 'high');
});

Then('the Priority dropdown uses themed animated choices without overflowing', async function () {
  const page = this.page;
  const priority = await field(page, 'Priority');
  const list = page.getByRole('listbox');
  for (const theme of ['light', 'dark']) {
    await openCatalog(page);
    const toggle = page.getByRole('switch', { name: 'Dark theme', exact: true });
    if (await toggle.getAttribute('aria-checked') !== String(theme === 'dark')) await toggle.click();
    await closeCatalog(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await priority.click();
    await expect.poll(() => list.evaluate(element => {
      const moving = element.getAnimations().filter(animation => {
        const frames = animation.effect.getKeyframes();
        return animation.playState === 'running' && animation.effect.getTiming().duration > 0 && ['translate', 'transform'].some(property =>
          new Set(frames.map(frame => frame[property]).filter(value => value !== undefined)).size > 1);
      });
      for (const animation of moving) animation.playbackRate = 0.1;
      return moving.length;
    })).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => list.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    await expectThemeColors(list, { backgroundColor: '--color-foreground', color: '--color-background' });
    const high = list.getByRole('option', { name: 'high', exact: true });
    await high.hover();
    await expectThemeColors(high, { backgroundColor: '--color-emphasis', color: '--color-background' });
    const bounds = await list.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
      `${theme} dropdown must fit inside the viewport.`);
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(priority).toBeFocused();
    await priority.press('Space');
    await expect(list).toBeVisible();
    const animating = await list.evaluate(async element => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return element.getAnimations().some(animation => animation.playState === 'running');
    });
    assert.equal(animating, false, 'Reduced-motion dropdowns must open without animation.');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  }
});

Then('Result limit arrows preserve bounds and input focus', async function () {
  const page = this.page;
  const input = await field(page, 'Result limit');
  const increase = page.getByRole('button', { name: 'Increase Result limit', exact: true });
  const decrease = page.getByRole('button', { name: 'Decrease Result limit', exact: true });
  await input.fill('1');
  for (const button of [increase, decrease]) {
    await expect(button).toHaveAttribute('tabindex', '-1');
    await expect(button).toHaveAttribute('type', 'button');
  }
  await decrease.click();
  await expect(input).toHaveValue('1');
  await increase.click();
  await expect(input).toHaveValue('2');
  await expect(input).toBeFocused();
  await input.press('ArrowUp');
  await expect(input).toHaveValue('3');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('2');
  await input.fill('100');
  await increase.click();
  await expect(input).toHaveValue('100');
  await decrease.click();
  await expect(input).toHaveValue('99');
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(increase).not.toBeFocused();
  await expect(decrease).not.toBeFocused();
  await expect(page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
});

for (const [verb, action] of [['increase', 'Increase'], ['decrease', 'Decrease']]) {
  When(`I ${verb} Estimated hours with its arrow`, async function () {
    const input = await field(this.page, 'Estimated hours');
    await input.focus();
    await this.page.getByRole('button', { name: `${action} Estimated hours`, exact: true }).click();
    await expect(input).toBeFocused();
    await expect(this.page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
  });
}

Then('number arrows reveal through hover and focus with the selected motion preference', async function () {
  const page = this.page;
  const input = await field(page, 'Result limit');
  const other = await field(page, 'Project name');
  const row = page.locator('.joined-field').filter({ has: page.getByRole('spinbutton', { name: 'Result limit', exact: true }) });
  const arrows = row.locator('.field-number-steppers');
  await other.focus();
  await page.mouse.move(0, 0);
  await expect(arrows).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await row.locator('label').hover();
  await expect.poll(() => arrows.evaluate(element => {
    const moving = element.getAnimations().filter(animation => ['transform', 'translate'].includes(animation.transitionProperty));
    for (const animation of moving) animation.playbackRate = 0.1;
    return moving.length;
  })).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(arrows).toBeVisible();
  await expect.poll(() => arrows.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  const contained = await arrows.evaluate(element => {
    const buttons = element.getBoundingClientRect();
    const field = element.closest('.field-number').getBoundingClientRect();
    return buttons.left >= field.left && buttons.right <= field.right + 1 && buttons.top >= field.top && buttons.bottom <= field.bottom + 1;
  });
  assert.ok(contained, 'Revealed arrows must fit inside the number field.');
  await page.mouse.move(0, 0);
  await expect(arrows).toBeHidden();
  await input.focus();
  await expect(arrows).toBeVisible();
  assert.equal(await arrows.evaluate(element => element.getAnimations().length), 0, 'Reduced-motion focus must reveal arrows without sliding.');
});
