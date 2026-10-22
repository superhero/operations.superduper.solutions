// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode } from './workspace.fixture.mjs';
import { holdHeightAnimations, seekHeightAnimation, finishHeightAnimations } from './height-animation.fixture.mjs';

const browserSection = page => page.locator('.settings-section').filter({ has: page.locator('summary[aria-label="Browser"]') });
Then('Browser settings show a compact building status before the dashboard with {string} motion in {string} theme', async function (motion, theme) {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: motion });
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Theme"]').click();
  const themeSwitch = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await themeSwitch.getAttribute('aria-checked') !== String(theme === 'dark')) await themeSwitch.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const section = browserSection(page);
  await expect(section.locator('.storage-dashboard')).toHaveCount(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => {
      window.browserBuildFrames = [];
      const sample = () => {
        const section = document.querySelector('summary[aria-label="Browser"]').parentElement;
        const panel = section.querySelector(':scope > .disclosure-panel');
        const building = section.querySelector('.storage-building');
        const dashboard = section.querySelector('.storage-dashboard');
        if (building && panel.getBoundingClientRect().height > 10) {
          // Resolve theme tokens through CSS, including palettes using color().
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-catalog-active-foreground)';
          building.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          const dots = building.querySelector('.building-dots');
          const animations = dots.getAnimations({ subtree: true }).filter(animation => animation.animationName?.endsWith('building-wave'));
          let scales;
          if (animations.length && !window.browserBuildFrames.length) {
            const animation = animations[0];
            const original = animation.currentTime;
            animation.pause();
            scales = [0, 300, 600, 900, 1200].map(time => {
              animation.currentTime = time;
              return new DOMMatrix(getComputedStyle(dots.children[0]).transform).a;
            });
            animation.currentTime = original;
            animation.play();
          }
          window.browserBuildFrames.push({ height: panel.getBoundingClientRect().height,
            dashboard: !!dashboard && getComputedStyle(dashboard).visibility !== 'hidden', color: getComputedStyle(building).color, expected,
            dots: [...dots.children].map(dot => dot.textContent), weight: getComputedStyle(building).fontWeight,
            dotSize: getComputedStyle(dots).fontSize, scales, animations: animations.length,
            delays: [...dots.children].map(dot => getComputedStyle(dot).animationDelay) });
        }
        if (!dashboard || getComputedStyle(dashboard).visibility === 'hidden' || section.querySelector(':scope > summary').getAttribute('aria-expanded') !== 'true')
          requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await section.locator('summary').first().click();
    await expect(section.locator('.storage-dashboard')).toBeVisible();
    await expect(section.locator('.storage-building')).toHaveCount(0);
    const frames = await page.evaluate(() => window.browserBuildFrames);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(frame => !frame.dashboard && frame.height < 100)).toBe(true);
    expect(frames.every(frame => frame.color === frame.expected)).toBe(true);
    for (const frame of frames) {
      expect(frame.dots).toEqual(['·', '·', '·']);
      expect(Number(frame.weight)).toBeGreaterThanOrEqual(700);
      expect(parseFloat(frame.dotSize)).toBe(20);
      expect(frame.animations).toBe(motion === 'reduce' ? 0 : 3);
      if (motion !== 'reduce') expect(new Set(frame.delays).size).toBe(3);
    }
    if (motion !== 'reduce') {
      const [start, rising, peak, falling, end] = frames[0].scales;
      expect(start).toBeLessThan(rising);
      expect(rising).toBeLessThan(peak);
      expect(peak).toBeGreaterThan(falling);
      expect(falling).toBeGreaterThan(end);
      expect(end).toBeCloseTo(start);
    }
    await expect.poll(() => section.locator(':scope > .disclosure-panel').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(100);
    await section.locator('summary').first().click();
    await expect(section.locator('summary').first()).toHaveAttribute('aria-expanded', 'false');
    // Reopen from the settled closed state, rather than interrupting its slide.
    await expect.poll(() => section.locator(':scope > .disclosure-panel').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  }
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

Then('Browser slides from its initial dots pane into the constructed dashboard', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setMode(page, 'settings');
  const section = browserSection(page);
  const panel = section.locator(':scope > .disclosure-panel');
  // The cheap indicator is already mounted before the first click.
  await expect(section.locator('.building-dots > span')).toHaveCount(3);
  await expect(section.locator('.storage-dashboard')).toHaveCount(0);
  const restore = await holdHeightAnimations(panel);
  try {
    await section.locator('summary').first().click();
    await expect.poll(() => panel.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
    const initial = await seekHeightAnimation(panel, 0.5);
    expect(initial.from).toBe(0);
    expect(initial.to).toBeGreaterThan(20);
    expect(initial.to).toBeLessThan(100);
    expect(initial.height).toBeGreaterThan(0);
    expect(initial.height).toBeLessThan(initial.to);
    await expect(section.locator('.storage-building')).toBeVisible();
    await expect(section.locator('.storage-dashboard')).toHaveCount(0);
    await finishHeightAnimations(panel);
    await expect.poll(() => panel.evaluate(el => el.getAnimations().some(animation => {
      const frames = animation.effect.getKeyframes();
      return parseFloat(frames[0].height) > 0 && parseFloat(frames.at(-1).height) === 0;
    }))).toBe(true);
    const closing = await seekHeightAnimation(panel, 0.5);
    expect(closing.from).toBeCloseTo(initial.to, 0);
    expect(closing.to).toBe(0);
    expect(closing.height).toBeGreaterThan(0);
    expect(closing.height).toBeLessThan(closing.from);
    await expect(section.locator('.storage-building')).toBeVisible();
    await expect(section.locator('.storage-dashboard')).not.toBeVisible();
    await expect(section.getByRole('region', { name: 'Usage history' })).not.toBeVisible();
    await finishHeightAnimations(panel);
    await expect.poll(() => panel.evaluate(el => el.getAnimations().some(animation =>
      parseFloat(animation.effect.getKeyframes().at(-1).height) > 100))).toBe(true);
    const full = await seekHeightAnimation(panel, 0.5);
    expect(full.from).toBe(0);
    expect(full.to).toBeGreaterThan(full.from);
    expect(full.height).toBeGreaterThan(full.from);
    expect(full.height).toBeLessThan(full.to);
    await finishHeightAnimations(panel);
    await expect(section.locator('.storage-dashboard')).toBeVisible();
    await expect(section.locator('.storage-building')).toHaveCount(0);
  } finally { await restore(); }
});
