// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, revealCatalogOperation, workflow, setMode } from './workspace.steps.mjs';
import { blockWorkflowSaving } from './workflow-storage.fixture.mjs';

const sheet = page => page.locator('[data-slot="sheet-content"]');
const nodes = page => page.locator('.svelte-flow__node-operation');

async function settleOpening(page) {
  await expect(sheet(page)).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect.poll(() => sheet(page).evaluate(element => element.getAnimations().length)).toBe(0);
}

// Keep the real exit animation in progress while exercising window shortcuts.
// Finishing those same browser animations also tests the presence completion path.
async function pauseDismissal(page, dismiss) {
  // Capture before the input: the 200ms exit can finish between browser calls.
  await sheet(page).evaluate(element => {
    element.workflowClosingAnimations = [];
    const capture = event => {
      if (event.target !== element || event.propertyName !== 'transform' || element.dataset.state !== 'closed') return;
      const animations = element.getAnimations().filter(animation => animation.transitionProperty === 'transform');
      if (!animations.length) return;
      element.removeEventListener('transitionrun', capture);
      element.workflowClosingAnimations = animations;
      for (const animation of animations) {
        animation.pause();
        // Keep the real presence transition inside its active interval.
        const timing = animation.effect.getTiming();
        animation.currentTime = timing.delay + Number(timing.duration) / 2;
      }
    };
    element.addEventListener('transitionrun', capture);
  });
  await dismiss();
  await expect(sheet(page)).toHaveAttribute('data-state', 'closed');
  await expect.poll(() => sheet(page).evaluate(element => element.workflowClosingAnimations?.length ?? 0),
    { message: 'The normal-motion Sheet must still have an exit animation.' }).toBeGreaterThan(0);
}

async function finishDismissal(page) {
  await sheet(page).evaluate(element => {
    const animations = new Set([...(element.workflowClosingAnimations ?? []), ...element.getAnimations()]);
    for (const animation of animations) animation.finish();
    delete element.workflowClosingAnimations;
  });
  await expect(sheet(page)).toHaveCount(0);
}

Then('dismissing animated mobile navigation with {string} protects the graph until it is gone', async function (dismissal) {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const selected = nodes(page).filter({ has: page.locator('.operation-node') }).and(page.locator('.selected'));
  await expect(selected).toHaveCount(1);
  const position = await selected.evaluate(element => element.style.transform);
  await openCatalog(page);
  // Dismiss a fully open sheet so this test can inspect its actual exit. A
  // reversed opening may legitimately finish before the next browser call.
  await settleOpening(page);
  await pauseDismissal(page, () => dismissal === 'Escape' ? page.keyboard.press('Escape') :
    sheet(page).getByRole('button', { name: 'Close', exact: true }).click());
  await selected.focus();
  await expect(selected).not.toBeFocused();
  for (const key of ['Delete', 'Backspace', 'ArrowRight', 'Shift+ArrowDown']) await page.keyboard.press(key);
  await expect(nodes(page)).toHaveCount(2);
  assert.equal(await selected.evaluate(element => element.style.transform), position);
  await finishDismissal(page);
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await expect(selected).toHaveAttribute('tabindex', '0');
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => selected.evaluate(element => element.style.transform)).not.toBe(position);
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(1);
});

Then('resizing an open desktop catalog preserves the {string} dialog focus and trap', async function (title) {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1000, height: 844 });
  await openCatalog(page);
  if (title === 'Unsaved changes') {
    await blockWorkflowSaving(page);
    await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  }
  await page.getByRole('button', { name: title === 'Saved workflows' ? 'Open workflow' : 'New workflow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  const initial = dialog.getByRole('button', { name: title === 'Saved workflows' ? 'Close' : 'Cancel', exact: true });
  await expect(initial).toBeFocused();
  for (const width of [390, 1000, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(initial).toBeFocused();
    await expect(sheet(page)).toHaveCount(0);
  }
  const buttons = await dialog.getByRole('button').count();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < buttons + 2; index += 1) {
      await page.keyboard.press(key);
      assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab must remain in the visible document dialog.');
    }
  }
  await page.keyboard.press('Escape');
  if (await dialog.evaluateAll(elements => elements.some(element => element.dataset.state === 'open'))) {
    // Focused help consumes the first Escape; the next dismisses the dialog.
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await expect(dialog).toHaveCount(0);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: title === 'Saved workflows' ? 'Open workflow' : 'New workflow', exact: true })).toBeFocused();
  const selected = nodes(page).and(page.locator('.selected'));
  const position = await selected.evaluate(element => element.style.transform);
  await selected.focus();
  await expect(selected).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => selected.evaluate(element => element.style.transform)).not.toBe(position);
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  await openCatalog(page);
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Dark theme', exact: true })).toBeFocused();
});

Then('dismissing mobile navigation preserves reading position with {string} motion', async function (motion) {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 568 });
  await page.emulateMedia({ reducedMotion: motion });
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  const heading = settings.locator('summary[aria-label="Application"]');
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  await heading.evaluate(async element => {
    const panel = document.getElementById(element.getAttribute('aria-controls'));
    await Promise.all((panel?.getAnimations({ subtree: true }) ?? [])
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
  const drawer = page.locator('.settings-drawer');
  const readingPosition = await drawer.evaluate(element => Math.min(250, element.scrollHeight - element.clientHeight));
  assert.ok(readingPosition > 0, 'The fixture must provide a nonzero reading position to preserve.');
  await drawer.evaluate((element, top) => element.scrollTo({ top, behavior: 'instant' }), readingPosition);
  await expect.poll(() => drawer.evaluate(element => element.scrollTop)).toBe(readingPosition);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  const bounds = await menu.boundingBox();
  assert.ok(bounds);
  // A native pointer click avoids Playwright scrolling a sticky target into view.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(sheet(page)).toBeVisible();
  assert.equal(await drawer.evaluate(element => element.scrollTop), readingPosition);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(menu).toBeFocused();
  assert.equal(await drawer.evaluate(element => element.scrollTop), readingPosition);
});

Then('animated navigation completes dismissal before changing workspace or adding an operation', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  await setMode(page, 'settings');
  const entry = await revealCatalogOperation(page, 'List projects');
  const action = entry.getByRole('button', { name: 'Add to workflow: List projects', exact: true });
  await settleOpening(page);
  await pauseDismissal(page, () => action.click());
  await expect(settings).toBeVisible();
  await expect(nodes(page)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(2);
  await finishDismissal(page);
  await expect(nodes(page)).toHaveCount(3);
  await expect(nodes(page).and(page.locator('.selected'))).toBeFocused();
});

Then('reopening navigation during keyboard selection cancels that destination', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setMode(page, 'settings');
  await openCatalog(page);
  const entry = await revealCatalogOperation(page, 'List projects');
  const destination = entry.getByRole('button', { name: 'Add to workflow: List projects', exact: true });
  const selected = page.getByRole('switch', { name: 'Dark theme', exact: true });
  await settleOpening(page);
  await destination.focus();
  await pauseDismissal(page, () => page.keyboard.press('Space'));
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  // Settings has its own tab stops behind the closing Sheet; focus the trigger
  // directly so this checks interrupted navigation, not that incidental order.
  await menu.focus();
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toHaveAttribute('data-state', 'open');
  await expect(selected).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  if (await sheet(page).evaluateAll(elements => elements.some(element => element.dataset.state === 'open'))) {
    // Keyboard help gets the first Escape; the next dismisses navigation.
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Settings workspace', exact: true })).toBeVisible();
  await expect(menu).toBeFocused();
  await openCatalog(page);
  await destination.focus();
  await page.keyboard.press('Space');
  await expect(sheet(page)).toHaveCount(0);
  await expect(workflow(page)).toBeVisible();
  await expect(nodes(page)).toHaveCount(3);
  // The selected operation receives focus after navigation finishes.
  await expect(nodes(page).and(page.locator('.selected'))).toBeFocused();
});
