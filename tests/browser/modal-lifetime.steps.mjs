// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, revealCatalogOperation, workflow, workspace } from './workspace.steps.mjs';
import { blockWorkflowSaving } from './workflow-storage.fixture.mjs';

const sheet = page => page.locator('[data-slot="sheet-content"]');
const nodes = page => page.locator('.svelte-flow__node-operation');

async function settleOpening(page) {
  await expect(sheet(page)).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect.poll(() => sheet(page).evaluate(element => element.getAnimations().length)).toBe(0);
}

// Keep the real exit animation in progress while exercising window shortcuts.
// Finishing those same browser animations also tests the presence completion path.
async function pauseDismissal(page) {
  await expect(sheet(page)).toHaveAttribute('data-state', 'closed');
  const count = await sheet(page).evaluate(element => {
    const animations = element.getAnimations();
    element.workflowClosingAnimations = animations;
    for (const animation of animations) {
      animation.pause();
      // A pending pause can otherwise settle just past the active interval,
      // where Chromium stops returning it from getAnimations() even though
      // the finished promise awaited by dialog presence is still pending.
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end))
        animation.currentTime = Math.min(Number(animation.currentTime ?? 0), end / 2);
    }
    return animations.length;
  });
  assert.ok(count > 0, 'The normal-motion Sheet must still have an exit animation.');
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
  if (dismissal === 'Escape') await page.keyboard.press('Escape');
  else await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
  await pauseDismissal(page);
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
  await expect(page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Workflows', exact: true })).toBeFocused();
});

Then('dismissing mobile navigation preserves reading position with {string} motion', async function (motion) {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 568 });
  await page.emulateMedia({ reducedMotion: motion });
  await page.getByRole('textbox', { name: 'Title', exact: true }).focus();
  const readingPosition = await page.evaluate(() => Math.min(250, document.documentElement.scrollHeight - window.innerHeight));
  assert.ok(readingPosition > 0, 'The fixture must provide a nonzero reading position to preserve.');
  await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), readingPosition);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(readingPosition);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  const bounds = await menu.boundingBox();
  assert.ok(bounds);
  // A native pointer click avoids Playwright scrolling a sticky target into view.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(sheet(page)).toBeVisible();
  assert.equal(await page.evaluate(() => window.scrollY), readingPosition);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(menu).toBeFocused();
  assert.equal(await page.evaluate(() => window.scrollY), readingPosition);
});

Then('animated navigation completes dismissal before changing workspace or adding an operation', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const destination of ['operations', 'workflow']) {
    await openCatalog(page);
    await settleOpening(page);
    await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: destination === 'operations' ? 'Operations' : 'Workflows', exact: true }).click();
    await pauseDismissal(page);
    await expect(destination === 'operations' ? page.locator('.workflow-workspace') : workspace(page)).toBeVisible();
    await finishDismissal(page);
    const target = destination === 'operations' ? workspace(page) : workflow(page);
    await expect(target).toBeVisible();
    await expect.poll(() => target.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  const entry = await revealCatalogOperation(page, 'List projects');
  const action = entry.getByRole('button', { name: 'Add to workflow: List projects', exact: true });
  await action.click();
  await pauseDismissal(page);
  await expect(nodes(page)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(2);
  await finishDismissal(page);
  await expect(nodes(page)).toHaveCount(3);
  await expect(nodes(page).and(page.locator('.selected'))).toBeFocused();
});

Then('reopening navigation during a keyboard mode change cancels that destination', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCatalog(page);
  const modes = page.getByRole('group', { name: 'Workspace', exact: true });
  const selected = modes.getByRole('button', { name: 'Workflows', exact: true });
  const destination = modes.getByRole('button', { name: 'Operations', exact: true });
  await expect(selected).toBeFocused();
  await settleOpening(page);
  await page.keyboard.press('Shift+Tab');
  await expect(destination).toBeFocused();
  await page.keyboard.press('Space');
  await pauseDismissal(page);
  await page.keyboard.press('Shift+Tab');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toHaveAttribute('data-state', 'open');
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  if (await sheet(page).evaluateAll(elements => elements.some(element => element.dataset.state === 'open'))) {
    // Keyboard help gets the first Escape; the next dismisses navigation.
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await expect(sheet(page)).toHaveCount(0);
  await expect(workflow(page)).toBeVisible();
  await expect(menu).toBeFocused();
  await openCatalog(page);
  await page.keyboard.press('Shift+Tab');
  await expect(destination).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sheet(page)).toHaveCount(0);
  await expect(workspace(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeFocused();
});
