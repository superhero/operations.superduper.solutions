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
    // Reveal also observes the media event in JavaScript; deliver it before opening.
    await new Promise(requestAnimationFrame);
    const panel = document.querySelector('.step-panel[aria-hidden="false"]');
    const viewport = document.querySelector('.step-viewport');
    const control = panel.querySelector('[aria-label="Review operation details"]');
    const details = panel.querySelector('#operation-details');
    const measure = () => {
      const content = panel.getBoundingClientRect();
      const clip = viewport.getBoundingClientRect();
      return { height: content.height, clipped: Math.max(0, content.bottom - clip.bottom) };
    };
    const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const measurements = [measure()];
    let animation;
    let timer;
    let captured;
    const ready = new Promise((resolve, reject) => {
      captured = resolve;
      timer = setTimeout(() => reject(new Error('The details grid transition did not start.')), 5000);
    });
    const started = event => {
      if (event.target !== details || event.propertyName !== 'grid-template-rows') return;
      animation = details.getAnimations().find(item =>
        item instanceof CSSTransition && item.transitionProperty === 'grid-template-rows');
      if (!animation) return;
      // Keep the real transition running so the app follows its changing size.
      // Freeze only its clock: CI may otherwise skip the whole 240ms animation.
      animation.playbackRate = 0;
      captured();
    };
    panel.addEventListener('transitionrun', started);
    try {
      control.click();
      await ready;
      clearTimeout(timer);
      await animation.ready;
      const { delay, duration } = animation.effect.getTiming();
      if (!(Number(duration) > 0)) throw new Error('The details transition must have a positive duration.');
      for (const progress of [0, 0.15, 0.35, 0.55, 0.75, 0.95]) {
        animation.currentTime = delay + Number(duration) * progress;
        await frame();
        if (animation.playState !== 'running') throw new Error('The details transition must remain running while sampled.');
        measurements.push(measure());
      }
      animation.playbackRate = 1;
      animation.finish();
      await animation.finished;
      await frame();
      measurements.push(measure());
      return measurements;
    } finally {
      clearTimeout(timer);
      panel.removeEventListener('transitionrun', started);
      if (animation) animation.playbackRate = 1;
    }
  });
  assert.ok(Math.max(...samples.map(sample => sample.height)) - Math.min(...samples.map(sample => sample.height)) > 40,
    'The check must observe an actual animated expansion.');
  assert.ok(samples.slice(1, -1).some(sample => sample.height > samples[0].height + 1 && sample.height < samples.at(-1).height - 1),
    'The check must observe intermediate expanded heights, not only the endpoints.');
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
  await expect(page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
});

Then('the optional Count slider preserves large signed integers and clears without a default', async function () {
  const page = this.page;
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
    await page.screenshot({ path: `tmp/test/integer-slider-${value ? Number(value) < 0 ? 'minimum' : 'maximum' : 'empty'}.png` });
    await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Prepared request', exact: true });
    await expect(preview).toBeVisible();
    assert.deepEqual(JSON.parse(await preview.innerText()).query, value ? { count: Number(value) } : {});
    await page.getByRole('button', { name: 'Edit inputs', exact: true }).click();
  }
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
  const input = await field(page, 'Estimated hours');
  const other = await field(page, 'Title');
  const row = page.locator('.joined-field').filter({ has: page.getByRole('spinbutton', { name: 'Estimated hours', exact: true }) });
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
