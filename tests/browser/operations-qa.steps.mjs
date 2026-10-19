// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { closeCatalog, expectFieldValue, includeField, field, openCatalog, restartRun, applyDisplayedTheme } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

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
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(priority).toBeFocused();
  await expect(page.getByRole('region', { name: /^(Prepared request|Step \d+ prepared request)$/ })).toHaveCount(0);
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
    await applyDisplayedTheme(page, theme);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const started = event => {
        if (!event.target.matches('.field-select-content')) return;
        for (const animation of event.target.getAnimations()) animation.playbackRate = 0.1;
        document.removeEventListener('animationstart', started, true);
      };
      document.addEventListener('animationstart', started, true);
    });
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
    await expectThemeColors(high, { backgroundColor: '--color-emphasis', color: '--color-primary-foreground' });
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

Then('the Result limit slider preserves bounds and keyboard focus', async function () {
  const page = this.page;
  await includeField(page, 'Result limit');
  const input = await field(page, 'Result limit');
  const slider = page.getByRole('slider', { name: 'Result limit', exact: true });
  await expect(slider).toHaveAttribute('aria-valuemin', '1');
  await expect(slider).toHaveAttribute('aria-valuemax', '100');
  await expect(page.getByRole('button', { name: /^(Increase|Decrease) Result limit$/ })).toHaveCount(0);
  await input.fill('1');
  await slider.focus();
  for (const [key, value] of [['ArrowLeft', 1], ['ArrowRight', 2], ['ArrowUp', 3], ['ArrowDown', 2],
    ['Home', 1], ['End', 100], ['ArrowRight', 100], ['ArrowLeft', 99]]) {
    await slider.press(key);
    await expect(input).toHaveValue(String(value));
    await expect(slider).toHaveAttribute('aria-valuenow', String(value));
    await expect(slider).toBeFocused();
  }
  await expect(page.getByRole('region', { name: /^(Prepared request|Step \d+ prepared request)$/ })).toHaveCount(0);
});

Then('the optional Count slider preserves large signed integers and clears without a default', async function () {
  const page = this.page;
  await includeField(page, 'Count');
  const input = await field(page, 'Count');
  const slider = page.getByRole('slider', { name: 'Count', exact: true });
  await expect(slider).toHaveAttribute('aria-valuemin', String(Number.MIN_SAFE_INTEGER));
  await expect(slider).toHaveAttribute('aria-valuemax', String(Number.MAX_SAFE_INTEGER));
  await expect(input).toHaveValue('');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not set');
  await (await field(page, 'Sample ID')).fill('integer-review');
  for (const value of [String(Number.MIN_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER), '']) {
    await input.fill(value);
    await expect(input).toHaveValue(value);
    if (value) await expect(slider).toHaveAttribute('aria-valuenow', value);
    else await expect(slider).toHaveAttribute('aria-valuetext', 'Not set');
    assert.equal(await input.evaluate(control => control.validity.valid), true);
    await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
    const preview = page.getByRole('region', { name: /^(Prepared request|Step \d+ prepared request)$/ });
    await expect(preview).toBeVisible();
    assert.deepEqual(JSON.parse(await preview.innerText()).query, value ? { count: Number(value) } : {});
    await restartRun(page, true);
  }
});

for (const [verb, action] of [['increase', 'Increase'], ['decrease', 'Decrease']]) {
  When(`I ${verb} Number value with its arrow`, async function () {
    await includeField(this.page, 'Number value');
    const input = await field(this.page, 'Number value');
    await input.focus();
    await this.page.getByRole('button', { name: `${action} Number value`, exact: true }).click();
    await expect(input).toBeFocused();
    await expect(this.page.getByRole('region', { name: /^(Prepared request|Step \d+ prepared request)$/ })).toHaveCount(0);
  });
}

Then('number arrows reveal through hover and focus with the selected motion preference', async function () {
  const page = this.page;
  await includeField(page, 'Number value');
  const input = await field(page, 'Number value');
  const other = await field(page, 'Title');
  const row = page.locator('.joined-field').filter({ has: page.getByRole('spinbutton', { name: 'Number value', exact: true }) });
  const arrows = row.locator('.field-number-steppers');
  await other.focus();
  await page.mouse.move(0, 0);
  await expect(arrows).toBeHidden();
  await arrows.evaluate(element => {
    const started = event => {
      if (!['transform', 'translate'].includes(event.propertyName)) return;
      for (const animation of element.getAnimations()) animation.playbackRate = 0.1;
      element.removeEventListener('transitionrun', started);
    };
    element.addEventListener('transitionrun', started);
  });
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

When('I restart the run with the same inputs', async function () {
  await restartRun(this.page, true);
});
