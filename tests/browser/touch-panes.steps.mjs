// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

const settingsToggle = page => page.locator('.site-header [aria-controls="settings-panel"]');
const navToggle = page => page.locator('.site-header [aria-controls="side-navigation"]');
async function closeInitialNavigation(page) {
  if (await navToggle(page).getAttribute('aria-expanded') === 'true') {
    await page.locator('#side-navigation').getByRole('button', { name: 'Close navigation', exact: true }).tap();
    await expect(page.locator('#side-navigation')).toHaveCount(0);
  }
}
async function settleScroll(locator) {
  let previous = -1, stable = 0;
  await expect.poll(async () => {
    const next = await locator.evaluate(element => element.scrollTop);
    stable = next === previous ? stable + 1 : 0; previous = next;
    return stable;
  }, { intervals: [100, 100, 100] }).toBeGreaterThanOrEqual(3);
}
const center = async locator => {
  const box = await locator.boundingBox();
  assert.ok(box, 'The gesture control must be visible.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

// Native Chromium touch dispatch exercises browser gesture arbitration, capture and cancellation.
async function stroke(world, point, dx, dy = 0, { cancel = false, during } = {}) {
  world.touchSession ??= await world.context.newCDPSession(world.page);
  const session = world.touchSession;
  const touch = (x, y) => [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(point.x, point.y) });
  for (let index = 1; index <= 8; index++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(point.x + dx * index / 8, point.y + dy * index / 8) });
  }
  if (during) await during();
  await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}

Then('a touch tablet resizes both docked panes and keeps side panes when space allows', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1920, height: 1000 });
  assert.equal(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches), true);
  await settingsToggle(page).tap();
  const left = page.getByRole('separator', { name: 'Navigation pane width', exact: true });
  const right = page.getByRole('separator', { name: 'Settings pane width', exact: true });
  assert.ok((await left.boundingBox()).width >= 44 && (await right.boundingBox()).width >= 44);
  await stroke(this, await center(left), 100);
  await expect(left).toHaveAttribute('aria-valuenow', '420');
  await stroke(this, await center(right), 180);
  await expect(right).toHaveAttribute('aria-valuenow', '720');
  await expect(page.getByRole('dialog', { name: 'Settings pane width controls' })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(right).toBeVisible();
  await expect(page.locator('.settings-mobile-header')).toHaveCount(0);
  await expect(settingsToggle(page)).toHaveAttribute('aria-expanded', 'true');
});

Then('compact pane grips follow touch swipes and ignore short wrong-direction and cancelled gestures', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await closeInitialNavigation(page);
  await settingsToggle(page).tap();
  const drawer = page.locator('#settings-panel');
  const grip = page.getByRole('button', { name: 'Close settings', exact: true });
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await stroke(this, await center(grip), 20);
  await expect(drawer).toHaveClass(/\bopen\b/);
  await stroke(this, await center(grip), 0, 70);
  await expect(drawer).toHaveClass(/\bopen\b/);
  await stroke(this, await center(grip), -90);
  await expect(drawer).toHaveClass(/\bopen\b/);
  await stroke(this, await center(grip), 110, 0, { cancel: true });
  await expect(drawer).toHaveClass(/\bopen\b/);
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await stroke(this, await center(grip), 140, 0, { during: async () => {
    const x = await drawer.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
    assert.ok(x > 70, 'The actual pane must follow the finger before release.');
  } });
  await expect(settingsToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  const nav = page.locator('#side-navigation');
  await expect(nav).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const close = nav.getByRole('button', { name: 'Close navigation', exact: true });
  await stroke(this, await center(close), -125, 0, { during: async () => {
    const x = await nav.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
    assert.ok(x < -70, 'Navigation must follow the leftward swipe.');
  } });
  await expect(nav).toHaveCount(0);
  await expect(navToggle(page)).toBeFocused();
});

Then('touch pane grips expose size controls and close panes without an X button', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  await settingsToggle(page).tap();
  const resize = page.getByRole('separator', { name: 'Settings pane width', exact: true });
  await resize.tap();
  const sizes = page.getByRole('dialog', { name: 'Settings pane width controls', exact: true });
  await expect(sizes).toBeVisible();
  await sizes.getByRole('button', { name: 'Narrow', exact: true }).tap();
  await expect(resize).toHaveAttribute('aria-valuenow', '360');
  await resize.tap();
  await sizes.getByRole('button', { name: 'Close pane', exact: true }).tap();
  await expect(settingsToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await closeInitialNavigation(page);
  await settingsToggle(page).tap();
  await expect(page.locator('.settings-mobile-header .material-symbols-rounded')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close settings', exact: true }).tap();
  await expect(settingsToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  await expect(page.locator('#side-navigation .sheet-close')).toHaveCount(0);
  await page.locator('#side-navigation').getByRole('button', { name: 'Close navigation', exact: true }).tap();
  await expect(page.locator('#side-navigation')).toHaveCount(0);
});

Then('vertical content scrolling and viewport height changes do not dismiss touch panes', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await closeInitialNavigation(page);
  await settingsToggle(page).tap();
  const panel = page.locator('#settings-panel');
  await panel.locator('summary').first().tap();
  await stroke(this, { x: 360, y: 600 }, 0, -280);
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(panel).toHaveClass(/\bopen\b/);
  await settleScroll(panel);
  await page.setViewportSize({ width: 390, height: 520 });
  await expect(panel).toHaveClass(/\bopen\b/);
  await page.getByRole('button', { name: 'Close settings', exact: true }).tap();
  await expect(settingsToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  const nav = page.locator('#side-navigation');
  await expect(nav).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await nav.getByText('Example.Com', { exact: true }).tap();
  await expect.poll(() => nav.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).length)).toBe(0);
  assert.ok(await nav.evaluate(element => element.scrollHeight > element.clientHeight), 'Expanded navigation must have scrollable content.');
  await stroke(this, { x: 200, y: 430 }, 0, -250);
  await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await settleScroll(nav);
  const scroll = await nav.evaluate(element => element.scrollTop);
  const close = nav.getByRole('button', { name: 'Close navigation', exact: true });
  await expect(close).toBeVisible();
  await stroke(this, await center(close), -125);
  await expect(nav).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBe(scroll);
});
