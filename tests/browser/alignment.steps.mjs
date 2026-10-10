// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, closeCatalog, chooseCatalogOperation, field, fillField, workflow, workflowAction, workspace, operationNodes, connections } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

Then('catalog paths, focus and tooltip dismissal behave consistently', async function () {
  const page = this.page;
  await openCatalog(page);
  const groups = page.locator('.catalog-group > summary');
  for (const heading of await groups.all()) await expect(heading).toHaveAttribute('aria-expanded', 'false');
  const root = page.locator('[data-catalog-group="projects"] > .catalog-group > summary');
  const overview = page.locator('[data-catalog-group="overview"] > .catalog-group > summary');
  const tasks = page.locator('[data-catalog-group="tasks"] > .catalog-group > summary');
  await root.click();
  await overview.click();
  const operations = page.locator('[data-catalog-group="overview"] .catalog-operation-action');
  const listProjects = page.getByRole('button', { name: 'Open form: List projects', exact: true });
  const getProject = page.getByRole('button', { name: 'Open form: Get project', exact: true });
  await operations.getByText('List projects', { exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: 'Operation: List projects', exact: true })).toBeVisible();
  await expect(await field(page, 'Project name')).toBeFocused();
  await expect(listProjects).toHaveAttribute('aria-current', 'page');
  await expect(overview).toHaveAttribute('aria-expanded', 'true');
  await operations.getByText('Get project', { exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: 'Operation: Get project', exact: true })).toBeVisible();
  await expect(await field(page, 'Project ID')).toBeFocused();
  await expect(listProjects).not.toHaveAttribute('aria-current', 'page');
  await expect(getProject).toHaveAttribute('aria-current', 'page');
  await tasks.click();
  await expect(overview).toHaveAttribute('aria-expanded', 'false');
  for (const operation of await operations.all()) await expect(operation).toBeHidden();
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tooltip')).toContainText('Switch to dark theme');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

Then('prompt keyboard controls preserve editing and search deliberately', async function () {
  const page = this.page;
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const submit = page.getByRole('button', { name: 'Find operations', exact: true });
  const progress = page.getByRole('navigation', { name: 'Progress', exact: true });
  await expect(prompt).toHaveAttribute('aria-required', 'true');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(workspace(page).getByRole('alert')).toHaveText('Enter a prompt to find a matching operation.');
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('aria-invalid', 'true');
  await prompt.fill('   \n ');
  await expect(workspace(page).getByRole('alert')).toHaveCount(0);
  await prompt.press('Enter');
  await expect(workspace(page).getByRole('alert')).toHaveText('Enter a prompt to find a matching operation.');
  await expect(progress.getByRole('button', { name: /Evaluation$/ })).toBeDisabled();

  await page.evaluate(() => document.fonts.ready);
  const originalViewport = page.viewportSize();
  const examples = page.locator('.prompt-suggestion-list button');
  const allNames = await examples.allTextContents();
  for (const width of [1280, 320, 390, 1280]) {
    const last = page.locator('.prompt-suggestion-list button:visible').last();
    await last.focus();
    const focusedExample = await last.innerText();
    await page.setViewportSize({ width, height: 844 });
    // ResizeObserver must restore hidden examples before we measure the wide row.
    if (width === 1280) await expect(page.locator('.prompt-suggestion-list button:visible'),
      'Widening the panel must restore the full example row.').toHaveText(allNames);
    await expect.poll(() => examples.evaluateAll(buttons => {
      const visible = buttons.filter(button => !button.hidden);
      const list = buttons[0].parentElement.getBoundingClientRect();
      const submit = document.querySelector('[aria-label="Find operations"]').getBoundingClientRect();
      return visible.length > 0 && visible.every((button, index) => {
        const box = button.getBoundingClientRect();
        return button === buttons[index] && box.left >= list.left && box.right <= list.right + 1 &&
          box.right <= submit.left && button.scrollWidth <= button.clientWidth + 1 &&
          Math.abs(box.top - visible[0].getBoundingClientRect().top) <= 1;
      }) && document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
    const shown = await page.locator('.prompt-suggestion-list button:visible').allTextContents();
    assert.deepEqual(shown, allNames.slice(0, shown.length), 'Responsive examples must keep their source order without partially clipped labels.');
    if (!shown.includes(focusedExample)) await expect(prompt).toBeFocused();
    for (const [index, name] of ['Prompt', 'Evaluation', 'Operation'].entries())
      await expect(progress.getByRole('button', { name: new RegExp(`${name}$`) })).toHaveAccessibleName(`${index + 1}. ${name}`);
    await expect(progress.getByRole('button')).toHaveCount(3);
  }
  await page.setViewportSize(originalViewport);
  await page.locator('.prompt-suggestion-list button:visible').first().click();
  await expect(prompt).toHaveValue('List projects');
  await expect(prompt).toBeFocused();
  await expect(workspace(page).getByRole('alert')).toHaveCount(0);
  await expect(prompt).not.toHaveAttribute('aria-invalid', 'true');
  await expect(progress.getByRole('button', { name: /Evaluation$/ })).toBeDisabled();
  await prompt.press('Shift+Enter');
  await expect(prompt).toHaveValue('List projects\n');
  await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await prompt.dispatchEvent('keydown', { key: 'Enter', repeat: true });
  await expect(prompt).toBeVisible();
  await prompt.press('Enter');
  await expect(workspace(this.page).getByRole('button', { name: 'Go to operation: List projects', exact: true })).toBeVisible();
  await expect(workspace(this.page).getByRole('heading', { name: 'Evaluation: Listed operations' })).toBeFocused();
  await this.page.getByRole('navigation', { name: 'Progress' }).getByRole('button', { name: /Operation$/ }).isDisabled().then(disabled => assert.equal(disabled, true));

  const catalog = page.getByRole('navigation', { name: 'Operation catalog', exact: true, includeHidden: true });
  const projects = catalog.locator('[data-catalog-group="projects"] > .catalog-group > summary');
  const overview = catalog.locator('[data-catalog-group="overview"] > .catalog-group > summary');
  const selectedOperation = catalog.locator('[data-operation-id="demo:listProjects"] > .catalog-operation-action');
  await closeCatalog(page);
  await expect(catalog).toBeHidden();
  await workspace(page).getByRole('button', { name: 'List projects', exact: true }).click();
  await expect(await field(page, 'Project name')).toBeFocused();
  await expect(projects).toHaveAttribute('aria-expanded', 'true');
  await expect(overview).toHaveAttribute('aria-expanded', 'true');
  await expect(selectedOperation).toHaveAttribute('aria-current', 'page');
  await expect(catalog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();

  await openCatalog(page);
  await expect(selectedOperation).toBeVisible();
  await projects.click();
  await expect(projects).toHaveAttribute('aria-expanded', 'false');
  await expect(overview).toHaveAttribute('aria-expanded', 'false');
  await progress.getByRole('button', { name: /Evaluation$/ }).click();
  await expect(catalog).toBeVisible();
  await workspace(page).getByRole('button', { name: 'Go to operation: List projects', exact: true }).click();
  await expect(await field(page, 'Project name')).toBeFocused();
  await expect(projects).toHaveAttribute('aria-expanded', 'true');
  await expect(overview).toHaveAttribute('aria-expanded', 'true');
  await expect(selectedOperation).toHaveAttribute('aria-current', 'page');
  await expect(selectedOperation).toBeVisible();
  await expect(catalog).toBeVisible();
});

Then('Unicode titles and decimal estimates can be corrected inline', async function () {
  const page = this.page;
  await fillField(page, 'Project ID', 'one');
  await fillField(page, 'Priority', 'normal');
  await fillField(page, 'Title', '😀'.repeat(121));
  await fillField(page, 'Estimated hours', '.5');
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  const title = await field(page, 'Title');
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(workspace(page).getByRole('alert')).toContainText('Title');
  await title.fill('😀'.repeat(120));
  await expect(workspace(page).getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  const request = page.getByRole('region', { name: 'Prepared request', exact: true });
  await expect(request).toBeVisible();
  const value = JSON.parse(await request.innerText());
  assert.equal(value.body.title, '😀'.repeat(120));
  assert.equal(value.body.estimate, 0.5);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
    const action = page.getByRole('button', { name: 'Add to workflow', exact: true });
    for (const hovered of [false, true]) {
      if (hovered) await action.hover(); else await page.mouse.move(0, 0);
      // Filled primary actions retain their semantic roles on hover in both themes.
      await expectThemeColors(action, { backgroundColor: '--color-primary', color: '--color-primary-foreground' });
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  for (const button of await page.locator('.request-footer button').all()) {
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

async function failStorage(page) {
  await page.evaluate(() => {
    window.restoreStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('Test storage unavailable'); };
  });
}
async function restoreStorage(page) {
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreStorage; });
}
Then('document dialogs allow cancellation and storage-error recovery', async function () {
  const page = this.page;
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(operationNodes(page, 'List projects')).toHaveCount(2);
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await failStorage(page);
  await dialog.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Test storage unavailable');
  await expect(dialog).toBeVisible();
  await restoreStorage(page);
  await dialog.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toBeFocused();
  await expect(operationNodes(page, 'List projects')).toHaveCount(0);
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
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('operations-flow-documents-v1'))[0]);
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
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Untitled workflow');
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toBeFocused();
  await page.evaluate(() => window.finishImport());
  await expect(workflow(page).getByRole('alert')).toHaveCount(0);
  await expect(operationNodes(page, 'List projects')).toHaveCount(0);
  }
});

Then('ambient and navigation movement honor live reduced motion', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const bitmap = () => page.locator('canvas.background-wave').evaluate(canvas => canvas.toDataURL());
  const first = await bitmap();
  await expect.poll(bitmap).not.toBe(first);
  await openCatalog(page);
  await page.locator('.catalog-group > summary').first().click();
  await expect.poll(() => page.locator('.catalog-group').first().evaluate(element => element.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('.catalog-group').first().evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
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
  const toolbar = await page.locator('.workflow-toolbar').boundingBox();
  const metadata = await page.locator('.document-meta').boundingBox();
  if (toolbar && metadata) assert.ok(toolbar.y + toolbar.height <= metadata.y, 'Wrapped toolbar must not cover document metadata.');
  await workflowAction(page, 'Save');
  await expect(workflow(page).getByText('Saved in this browser.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('Changed draft');
  await expect(workflow(page).getByText('Saved in this browser.', { exact: true })).toHaveCount(0);
  await expect(workflow(page).getByText('Unsaved changes', { exact: true })).toBeVisible();
});

Then('step motion preserves focus and inactive-panel isolation', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('List projects');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).press('Enter');
  await expect.poll(() => page.locator('.step-track').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await expect(workspace(page).getByRole('heading', { name: 'Evaluation: Listed operations' })).toBeFocused();
  await workspace(page).getByRole('button', { name: 'Go to operation: List projects', exact: true }).click();
  await expect(await field(page, 'Project name')).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: 'List projects', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Edit inputs', exact: true }).click();
  await expect(await field(page, 'Project name')).toBeFocused();
  const progress = page.getByRole('navigation', { name: 'Progress' });
  await progress.getByRole('button', { name: /Prompt$/ }).click();
  await progress.getByRole('button', { name: /Operation$/ }).click();
  await expect(await field(page, 'Project name')).toBeFocused();
  await expect.poll(() => page.locator('.step-track').evaluate(element => element.getAnimations().length)).toBe(0);
  await expect.poll(() => page.locator('.step-viewport').evaluate(element => Math.abs(element.clientHeight - element.querySelector('[aria-hidden="false"]').clientHeight) <= 1)).toBe(true);
});

Then('returning to Operation preserves expanded details and the page top with either motion preference', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 600 });
  const progress = page.getByRole('navigation', { name: 'Progress', exact: true });
  const details = page.getByRole('button', { name: 'Review operation details', exact: true });
  const title = workspace(page).getByRole('heading', { name: 'Operation: List projects', exact: true });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    if (await details.getAttribute('aria-expanded') !== 'true') await details.click();
    await expect(page.getByRole('region', { name: 'Operation report', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('#operation-details').evaluate(element => element.getAnimations().length)).toBe(0);
    assert.ok(await (await field(page, 'Project name')).evaluate(element => element.getBoundingClientRect().top > innerHeight),
      'The open report must place the first input below the viewport to exercise unwanted scrolling.');

    await progress.getByRole('button', { name: /Evaluation$/ }).click();
    await expect(workspace(page).getByRole('heading', { name: 'Evaluation: Listed operations', exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await progress.getByRole('button', { name: /Operation$/ }).click();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(title).toBeFocused();
    await expect(page.getByRole('region', { name: 'Operation report', exact: true })).toBeVisible();
    const sample = await title.evaluate(async element => {
      let maximumScroll = 0;
      let titleStayedVisible = true;
      const start = performance.now();
      do {
        await new Promise(requestAnimationFrame);
        const bounds = element.getBoundingClientRect();
        const header = document.querySelector('.site-header').getBoundingClientRect();
        maximumScroll = Math.max(maximumScroll, Math.abs(scrollY));
        titleStayedVisible &&= bounds.top >= header.bottom && bounds.bottom <= innerHeight;
      } while (performance.now() - start < 650);
      return { maximumScroll, titleStayedVisible };
    });
    assert.ok(sample.maximumScroll <= 1, `${reducedMotion}: returning to Operation caused delayed scrolling by ${sample.maximumScroll}px.`);
    assert.ok(sample.titleStayedVisible, `${reducedMotion}: the operation title must remain below the header and inside the viewport.`);
    await expect(title).toBeFocused();
  }
});

Then('connection movement responds without changing the saved plan', async function () {
  const page = this.page;
  await workflowAction(page, 'Save');
  const path = connections(page).locator('.svelte-flow__edge-path');
  await expect(path).toHaveCount(1);
  const dash = () => path.evaluate(element => getComputedStyle(element).strokeDashoffset);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const offset = await dash();
  await expect.poll(dash).not.toBe(offset);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => path.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect.poll(() => path.evaluate(element => getComputedStyle(element).strokeDasharray)).not.toBe('none');
  await expect(workflow(page).getByText('Saved locally', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dashed connections', exact: true }).click();
  await expect.poll(() => path.evaluate(element => getComputedStyle(element).strokeDasharray)).toBe('none');
});

Then('a workspace round trip preserves input focus and scroll', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 390 });
  await openCatalog(page);
  await fillField(page, 'Title', 'Remember this draft');
  const title = await field(page, 'Title');
  await title.focus();
  await page.evaluate(() => window.scrollTo(0, Math.min(300, document.documentElement.scrollHeight - innerHeight)));
  const readingPosition = await page.evaluate(() => scrollY);
  assert.ok(readingPosition > 0, 'The fixture must have a scrollable form.');
  const modes = page.getByRole('group', { name: 'Workspace', exact: true });
  await modes.getByRole('button', { name: 'Workflows', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.workflow-workspace')))).toBe(true);
  await modes.getByRole('button', { name: 'Operations', exact: true }).click();
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Remember this draft');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(readingPosition);
});
