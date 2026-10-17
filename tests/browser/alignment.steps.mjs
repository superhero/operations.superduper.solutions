// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { storedWorkflows, blockWorkflowSaving, restoreWorkflowSaving } from "./workflow-storage.fixture.mjs";
import { closeWorkflowDetails, renameWorkflow, workflowNameInput } from "./workflow-details.fixture.mjs";
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog, chooseCatalogOperation, field, fillField, workflow, workflowAction, workspace, operationNodes, connections, searchOperations } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

// Capture before input so a busy browser cannot finish short motion before
// Playwright sees it. Keep the real animation running with only its clock held.
async function captureMotion(locator, property) {
  return locator.evaluateHandle((element, property) => {
    const original = element.animate;
    const capture = animation => {
      if (!state.motion && animation.effect?.getKeyframes().some(frame => property in frame)) {
        animation.playbackRate = 0;
        state.motion = animation;
      }
    };
    const started = event => {
      if (event.target === element && event.propertyName === property)
        element.getAnimations().forEach(capture);
    };
    const state = { motion: null, property, restore() {
      element.animate = original;
      element.removeEventListener('transitionrun', started);
      if (state.motion) state.motion.playbackRate = 1;
    } };
    element.animate = function (...args) {
      const animation = original.apply(this, args);
      capture(animation);
      return animation;
    };
    element.addEventListener('transitionrun', started);
    return state;
  }, property);
}

async function expectCapturedMotion(capture) {
  await expect.poll(() => capture.evaluate(({ motion, property }) => Boolean(motion
    && motion.playState === 'running' && motion.effect.getTiming().duration > 0
    && new Set(motion.effect.getKeyframes().map(frame => frame[property])).size > 1))).toBe(true);
}

Then('catalog paths, focus and tooltip dismissal behave consistently', async function () {
  const page = this.page;
  await openCatalog(page);
  const root = page.locator('[data-catalog-group="projects"] > .catalog-group > summary');
  const overview = page.locator('[data-catalog-group="overview"] > .catalog-group > summary');
  const tasks = page.locator('[data-catalog-group="tasks"] > .catalog-group > summary');
  await root.click();
  await overview.click();
  await page.getByRole('button', { name: 'Add to workflow: List projects', exact: true }).click();
  await expect(operationNodes(page, 'List projects')).toBeFocused();
  await page.getByRole('button', { name: 'Add to workflow: Get project', exact: true }).click();
  await expect(operationNodes(page, 'Get project')).toBeFocused();
  await expect(overview).toHaveAttribute('aria-expanded', 'true');
  await tasks.click();
  await expect(overview).toHaveAttribute('aria-expanded', 'false');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('tooltip')).toContainText('Settings');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

Then('prompt keyboard controls preserve editing and search deliberately', async function () {
  const page = this.page;
  await openCatalog(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await searchOperations(page, '   \n ');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Progress', exact: true })).toHaveCount(0);
  await searchOperations(page, 'List projects');
  await expect(prompt).toHaveValue('List projects');
  await expect(prompt).toBeFocused();
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'List projects');
  await prompt.press('Shift+Enter');
  await expect(prompt).toHaveValue('List projects\n');
  await prompt.dispatchEvent('compositionstart');
  await prompt.evaluate(input => {
    input.value = 'Get project';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Get project', isComposing: true }));
  });
  await page.waitForTimeout(250); // Longer than the live matching debounce; unfinished composition must not evaluate.
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', '');
  await expect(prompt).toBeFocused();
  await expect(operationNodes(page, 'Get project')).toHaveCount(0);
  await prompt.dispatchEvent('compositionend');
  await expect(page.locator('.catalog-prompt')).toHaveAttribute('data-evaluated-prompt', 'Get project');
  await expect(prompt).toBeFocused();
  const action = page.getByRole('button', { name: 'Add to workflow: Get project', exact: true });
  await action.focus();
  await action.press('Enter');
  await expect(operationNodes(page, 'Get project')).toBeFocused();
});

Then('Unicode titles and decimal estimates can be corrected inline', async function () {
  const page = this.page;
  await fillField(page, 'Project ID', 'one');
  await fillField(page, 'Priority', 'normal');
  await fillField(page, 'Title', '😀'.repeat(121));
  await fillField(page, 'Estimated hours', '.5');
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  const title = await field(page, 'Title');
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(workspace(page).getByRole('alert')).toContainText('Title');
  await title.fill('😀'.repeat(120));
  await expect(workspace(page).getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  const request = page.getByRole('region', { name: /^(Prepared request|Step \d+ prepared request)$/ });
  await expect(request).toBeVisible();
  const value = JSON.parse(await request.innerText());
  assert.equal(value.body.title, '😀'.repeat(120));
  assert.equal(value.body.estimate, 0.5);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
    const action = workspace(page).getByRole('button', { name: 'Quit', exact: true });
    for (const hovered of [false, true]) {
      if (hovered) await action.hover(); else await page.mouse.move(0, 0);
      // Quit retains its badge palette on hover in both themes.
      await expectThemeColors(action, { backgroundColor: '--color-badge-background', color: '--color-badge-foreground' });
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  for (const button of await workspace(page).locator('.workflow-run > footer button').all()) {
    const bounds = await button.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320, 'Both request actions must fit the viewport.');
  }
});

Then('mobile navigation protects graph shortcuts and returns useful focus', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await closeCatalog(page);
  await expect(operationNodes(page, 'List projects')).toHaveCount(2);
  await chooseCatalogOperation(page, 'List projects', 'workflow');
  await expect(operationNodes(page, 'List projects')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.workflow-workspace')))).toBe(true);
});

const failStorage = page => blockWorkflowSaving(page, 'Test storage unavailable');
const restoreStorage = restoreWorkflowSaving;
Then('document dialogs allow cancellation and storage-error recovery', async function () {
  const page = this.page;
  await failStorage(page);
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(operationNodes(page, 'List projects')).toHaveCount(2);
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Test storage unavailable');
  await expect(dialog).toBeVisible();
  await restoreStorage(page);
  await dialog.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(workflowNameInput(page)).toBeFocused();
  await expect(operationNodes(page, 'List projects')).toHaveCount(0);
  await closeWorkflowDetails(page);
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Saved workflows', exact: true });
  await dialog.getByRole('button', { name: 'Remove Untitled workflow', exact: true }).click();
  await expect(dialog).toContainText('Remove “Untitled workflow”');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: 'Remove Untitled workflow', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove Untitled workflow', exact: true }).click();
  await failStorage(page);
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Untitled workflow');
  await expect(dialog.getByRole('alert')).toContainText('Test storage unavailable');
  await restoreStorage(page);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog).toContainText('No saved workflows yet.');
});

Then('a delayed import cannot supersede New', async function () {
  const page = this.page;
  const saved = (await storedWorkflows(page))[0];
  await page.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = function () {
      return new Promise((resolve, reject) => {
        window.finishImport = () => text.call(this).then(resolve, reject);
      });
    };
  });
  for (const document of [saved, { version: 999 }]) {
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({ name: 'stale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await expect(workflowNameInput(page)).toHaveValue('Untitled workflow');
  await expect(workflowNameInput(page)).toBeFocused();
  await page.evaluate(() => window.finishImport());
  await expect(workflow(page).getByRole('alert')).toHaveCount(0);
  await expect(operationNodes(page, 'List projects')).toHaveCount(0);
  await closeWorkflowDetails(page);
  }
});

Then('ambient and navigation movement honor live reduced motion', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const bitmap = () => page.locator('canvas.background-wave').evaluate(canvas => canvas.toDataURL());
  const first = await bitmap();
  await expect.poll(bitmap).not.toBe(first);
  await openCatalog(page);
  const group = page.locator('.catalog-group').first();
  const capture = await captureMotion(group.locator('.disclosure-panel').first(), 'height');
  try {
    await group.locator(':scope > summary').click();
    await expectCapturedMotion(capture);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => group.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  } finally {
    await capture.evaluate(state => state.restore());
    await capture.dispose();
  }
  const still = await bitmap();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await bitmap(), still, 'Reduced motion must stop the ambient canvas.');
  await closeCatalog(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const resumed = await bitmap();
  await expect.poll(bitmap).not.toBe(resumed);
});

Then('repeated nodes and short viewports remain usable', async function () {
  const page = this.page;
  await expect(workflow(page).getByLabel('Instance 1', { exact: true })).toBeVisible();
  await expect(workflow(page).getByLabel('Instance 2', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const status = page.locator('.site-header .document-meta');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect.poll(async () => {
    const [toolbar, metadata, header, lastButton] = await Promise.all([
      page.locator('.workflow-toolbar').boundingBox(), status.boundingBox(),
      page.locator('.site-header').boundingBox(), page.locator('.workflow-toolbar button:visible').last().boundingBox(),
    ]);
    return Boolean(toolbar && metadata && header && lastButton &&
      metadata.y >= header.y && metadata.y + metadata.height <= header.y + header.height + 1 &&
      metadata.x >= header.x && metadata.x + metadata.width <= header.x + header.width + 1 &&
      metadata.y + metadata.height <= toolbar.y &&
      Math.abs(metadata.x + metadata.width - lastButton.x - lastButton.width) <= 1);
  }).toBe(true);
  await expect(status.getByText('Saved locally', { exact: true })).toBeVisible();
  await renameWorkflow(page, 'Changed draft');
  await expect(status.getByText('Saved locally', { exact: true })).toBeVisible();
  await expect.poll(async () => (await storedWorkflows(page)).at(-1).name).toBe('Changed draft');
});





Then('connection movement responds without changing the saved plan', async function () {
  const page = this.page;
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  const path = connections(page).locator('.svelte-flow__edge-path');
  await expect(path).toHaveCount(1);
  const saved = await storedWorkflows(page);
  // Verify initial motion and resumption after live reduced-motion cancellation.
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => path.evaluate(element => element.getAnimations().some(animation =>
      animation.playState === 'running' && animation.effect.getKeyframes().some(frame => 'strokeDashoffset' in frame)))).toBe(true);
    const samples = await path.evaluate(async element => {
      const animation = element.getAnimations().find(item => item.effect.getKeyframes().some(frame => 'strokeDashoffset' in frame));
      await animation.ready;
      const before = animation.currentTime;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const advanced = animation.currentTime > before;
      const { delay, duration, iterations } = animation.effect.getTiming();
      const frames = animation.effect.getKeyframes();
      const first = parseFloat(frames[0].strokeDashoffset);
      const last = parseFloat(frames.at(-1).strokeDashoffset);
      const offsets = [];
      try {
        animation.playbackRate = 0;
        for (const progress of [0.2, 0.4, 0.8]) {
          animation.currentTime = delay + Number(duration) * progress;
          offsets.push({ value: parseFloat(getComputedStyle(element).strokeDashoffset), expected: first + (last - first) * progress });
        }
      } finally { animation.playbackRate = 1; }
      return { advanced, duration, infinite: iterations === Infinity, first, last, offsets };
    });
    await this.attach(JSON.stringify({ cycle: cycle + 1, ...samples }), 'application/json');
    assert.ok(samples.advanced && samples.duration > 0 && samples.infinite, 'Dashed connections must run continuously on the browser timeline.');
    assert.ok(Number.isFinite(samples.first) && Number.isFinite(samples.last) && samples.first !== samples.last,
      `Dash keyframes must use interpolable lengths: ${JSON.stringify(samples)}`);
    assert.ok(samples.offsets.every(sample => Number.isFinite(sample.value) && Math.abs(sample.value - sample.expected) < 0.02),
      `Dashes must interpolate smoothly between endpoints: ${JSON.stringify(samples)}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => path.evaluate(element => element.getAnimations().length)).toBe(0);
    await expect.poll(() => path.evaluate(element => getComputedStyle(element).strokeDasharray)).not.toBe('none');
    await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
    assert.deepEqual(await storedWorkflows(page), saved, 'Motion preferences must not change the saved workflow.');
  }
  await page.getByRole('button', { name: 'Dashed connections', exact: true }).click();
  await expect.poll(() => path.evaluate(element => getComputedStyle(element).strokeDasharray)).toBe('none');
});
