// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { chooseCatalogOperation, closeCatalog, field, fillField, expectFieldValue, openCatalog, workspace, searchOperations,
  workflow, workflowAction, operationNodes, restartRun, quitRun, executeOperation, applyDisplayedTheme } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

async function expectUnclippedFocus(control) {
  await control.focus();
  await expect(control).toBeFocused();
  const result = await control.evaluate(element => {
    const ring = element.closest('.joined-field') ?? element;
    const style = getComputedStyle(ring);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const bounds = ring.getBoundingClientRect();
    const clipped = [];
    for (let parent = ring.parentElement; parent; parent = parent.parentElement) {
      // Root overflow propagates to the viewport; it does not clip a fixed
      // Sheet portal to the short underlying document's body rectangle.
      if (parent === document.body || parent === document.documentElement) continue;
      const parentStyle = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      const margin = parseFloat(parentStyle.overflowClipMargin) || 0;
      for (const [axis, start, end] of [['X', 'left', 'right'], ['Y', 'top', 'bottom']]) {
        const overflow = parentStyle[`overflow${axis}`];
        if (!['hidden', 'clip'].includes(overflow)) continue;
        const allowance = overflow === 'clip' ? margin : 0;
        if (bounds[start] - extent < box[start] - allowance - 0.5 || bounds[end] + extent > box[end] + allowance + 0.5)
          clipped.push(`${parent.className} ${axis}`);
      }
    }
    if (bounds.left - extent < -0.5 || bounds.right + extent > innerWidth + 0.5 ||
        bounds.top - extent < -0.5 || bounds.bottom + extent > innerHeight + 0.5) clipped.push('viewport');
    return { extent, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), radius: parseFloat(style.borderTopLeftRadius), style: style.outlineStyle, clipped };
  });
  assert.ok(result.extent > 0 && result.style !== 'none', 'Keyboard focus needs a visible outline.');
  assert.deepEqual(result.clipped, [], 'The full focus outline must survive every clipping ancestor.');
  return result;
}

async function selectTheme(page, theme) {
  await openCatalog(page);
  const toggle = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await toggle.getAttribute('aria-checked') !== String(theme === 'dark')) await toggle.click();
  await closeCatalog(page);
}

async function controlContrasts(controls) {
  return controls.evaluateAll(elements => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value);
    };
    const composite = (foreground, background) => background.map((value, index) => foreground[index] * foreground[3] + value * (1 - foreground[3]));
    const luminance = rgb => rgb.map(value => value / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrast = (foreground, background) => {
      const pair = [luminance(composite(foreground, background)), luminance(background)].sort((a, b) => a - b);
      return (pair[1] + .05) / (pair[0] + .05);
    };
    return elements.flatMap(control => {
      const ancestors = [];
      for (let node = control; node; node = node.parentElement) ancestors.unshift(node);
      const backdrop = ancestors.slice(0, -1).reduce((color, node) => composite(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255]);
      const style = getComputedStyle(control);
      const background = composite(rgba(style.backgroundColor), backdrop);
      const label = control.getAttribute('aria-label') || control.id || control.textContent;
      const results = [{ label, minimum: 4.5, ratio: contrast(rgba(style.color), background) }];
      if (control.matches('textarea')) {
        const placeholder = getComputedStyle(control, '::placeholder');
        const color = rgba(placeholder.color);
        color[3] *= Number(placeholder.opacity);
        results.push({ label: `${label} placeholder`, minimum: 4.5, ratio: contrast(color, background) });
      }
      return results;
    });
  });
}

Then('operations controls retain their complete keyboard focus outline', async function () {
  const page = this.page;
  await openCatalog(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await searchOperations(page, 'Get project');
  const toggle = page.getByRole('button', { name: 'Review matching details', exact: true });
  for (const theme of ['light', 'dark']) {
    await selectTheme(page, theme);
    await openCatalog(page);
    await page.mouse.move(0, 0);
    const ring = await expectUnclippedFocus(prompt);
    assert.ok(ring.width >= 3 && ring.offset > 0 && ring.radius > 0, 'The prompt needs a separated focus ring around rounded corners.');
    await expectThemeColors(prompt, { backgroundColor: '--color-foreground', color: '--color-background', outlineColor: '--color-ring' });
    await expectThemeColors(prompt, { color: '--color-surface' }, '::placeholder');
    await expectThemeColors(page.locator('.catalog-prompt .prompt-actions'), {
      backgroundColor: '--color-badge-background', color: '--color-badge-foreground'
    });
    const contrasts = await controlContrasts(page.locator('.catalog-prompt textarea'));
    for (const { label, minimum, ratio } of contrasts)
      assert.ok(ratio >= minimum, `${theme} ${label} needs readable contrast: ${ratio.toFixed(2)}:1.`);
  }
  await prompt.focus();
  await prompt.press('Tab');
  await expect(toggle).toBeFocused();
  await expectUnclippedFocus(toggle);
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const suggested = 'Get project';
  const action = page.getByRole('button', { name: `Add to workflow: ${suggested}`, exact: true });
  await expectUnclippedFocus(action);
  await action.press('Enter');
  // Mobile selection adds the node after its navigation exit finishes.
  await expect(operationNodes(page, suggested)).toBeVisible();
  await closeCatalog(page);
  await workflowAction(page, 'Run');
  await expectUnclippedFocus(workspace(page).locator('.field-input:visible,.field-select-trigger:visible').first());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

Then('request fields remain readable and preserve accessible editing in both themes', async function () {
  const page = this.page;
  await chooseCatalogOperation(page, 'Create task');
  await expect(workspace(page).getByRole('heading', { name: '1. Create task', exact: true })).toBeVisible();
  const draft = { 'Project ID': 'visual-draft', Title: 'Preserve this visual draft', Priority: 'normal', 'Estimated hours': '0.5' };
  for (const [label, value] of Object.entries(draft)) {
    await fillField(page, label, value);
    const control = await field(page, label);
    await expect(control).toHaveAccessibleName(label);
    assert.equal(await control.evaluate(element => element.getAttribute('role') === 'combobox' ? element.getAttribute('aria-required') === 'true' : element.required), label !== 'Estimated hours',
      `${label} must expose its required state without adding the decorative marker to its accessible name.`);
  }

  const help = workspace(page).getByRole('button', { name: 'About Project ID', exact: true });
  for (const label of ['Title', 'Priority', 'Estimated hours'])
    await expect(workspace(page).getByRole('button', { name: `About ${label}`, exact: true })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await applyDisplayedTheme(page, theme);
    await fillField(page, 'Priority', '');
    const placeholder = workspace(page).locator('.field-select-value.placeholder');
    await expect(placeholder).toHaveText('Select…');
    for (const { ratio } of await controlContrasts(placeholder))
      assert.ok(ratio >= 4.5, `${theme} empty dropdown text must remain readable in the run dialog: ${ratio.toFixed(2)}:1.`);
    await fillField(page, 'Priority', 'normal');
    await page.mouse.move(0, 0);
    for (const row of await workspace(page).locator('.joined-field').all()) {
      const input = row.locator('.field-input:visible,.field-select-trigger:visible');
      const required = await input.evaluate(element => element.getAttribute('role') === 'combobox' ? element.getAttribute('aria-required') === 'true' : element.required);
      await expectThemeColors(row, { backgroundColor: '--color-background' });
      await expectThemeColors(input, { color: '--color-foreground' });
      await expectThemeColors(row.locator('label'), { backgroundColor: '--color-muted-foreground', color: '--color-surface' });
      const actions = row.locator('.field-actions');
      if (await actions.count()) await expectThemeColors(actions, { backgroundColor: '--control-addon' });
      else assert.equal(required, false, 'A required field still needs its trailing required marker.');
      if (required) await expectThemeColors(row.locator('.required-marker'), { color: '--control-label' });
    }
    const contrasts = await controlContrasts(workspace(page).locator('.joined-field .field-input:visible, .joined-field .field-select-trigger:visible, .joined-field label'));
    assert.equal(contrasts.length, 8, 'The check must cover all four entered values and all four labels, including required fields.');
    for (const { label, minimum, ratio } of contrasts)
      assert.ok(ratio >= minimum, `${theme} ${label} needs readable contrast: ${ratio.toFixed(2)}:1.`);

    const project = await field(page, 'Project ID');
    await expectUnclippedFocus(project);
    await expectThemeColors(project.locator('..'), { outlineColor: '--color-ring' });
    await expectThemeColors(help, { color: '--control-info' });
    await help.hover();
    await expectThemeColors(help, { color: '--control-info' });
    await page.mouse.move(0, 0);
    await help.focus();
    await page.keyboard.press('Enter');
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expectThemeColors(help, { color: '--control-label' });
    await expect(await field(page, 'Project ID')).toHaveAccessibleDescription(/The identifier of the project to work with\..*Type string.*Required Yes/);
    await expect(help).toBeFocused();
    await page.keyboard.press('Space');
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expectThemeColors(help, { color: '--control-info' });
    await expect(await field(page, 'Project ID')).toHaveAccessibleDescription('');
    for (const [label, value] of Object.entries(draft)) await expectFieldValue(page, label, value);

    const contained = await workspace(page).locator('.joined-field').evaluateAll(rows => rows.every(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && row.scrollWidth <= row.clientWidth + 1 &&
        [...row.querySelectorAll('label,.field-input,.field-select-trigger,button,.field-actions')].filter(control => control.getClientRects().length && getComputedStyle(control).visibility === 'visible').every(control => {
          const box = control.getBoundingClientRect();
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        });
    }));
    assert.ok(contained, `${theme} inputs, labels, required markers and help must fit their rows.`);
    const bounds = await page.getByRole('button', { name: 'Review operation details', exact: true }).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width,
      'Review operation details must remain reachable without horizontal scrolling.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await expect(page.getByRole('region', { name: /^(Prepared request|Step \d+ prepared request)$/ })).toHaveCount(0);
});

Then('matching menu rows add operations with pointer and keyboard', async function () {
  const page = this.page;
  const catalog = page.getByRole('navigation', { name: 'Operation catalog', exact: true });
  const action = catalog.getByRole('button', { name: 'Add to workflow: Get project', exact: true });
  await action.getByText('Get project', { exact: true }).click();
  await expect(operationNodes(page, 'Get project')).toHaveCount(1);
  await expect(operationNodes(page, 'Get project')).toBeFocused();
  await searchOperations(page, 'List projects');
  await catalog.getByRole('button', { name: 'Add to workflow: List projects', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(operationNodes(page, 'List projects')).toHaveCount(1);
  await expect(operationNodes(page, 'List projects')).toBeFocused();
  await expect(catalog.locator('[aria-current="page"]')).toHaveCount(0);
});

Then('matching menu actions retain their theme colors across evaluations', async function () {
  const page = this.page;
  for (const theme of ['light', 'dark']) {
    await selectTheme(page, theme);
    await searchOperations(page, 'Get project');
    const action = page.getByRole('button', { name: 'Add to workflow: Get project', exact: true });
    await action.click();
    await expect(action).not.toHaveAttribute('aria-current');
    await page.mouse.move(0, 0);
    await expectThemeColors(action, { color: '--color-catalog-foreground' });
    await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await searchOperations(page, 'List projects');
    await expect(action).not.toHaveAttribute('aria-current');
    await action.hover();
    await expectThemeColors(action, { color: '--color-catalog-foreground' });
    await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(operationNodes(page, 'Get project')).toHaveCount(theme === 'light' ? 1 : 2);
  }
});

Then('responsive prompt navigation preserves the workflow and its prompt', async function () {
  const page = this.page;
  const node = operationNodes(page, 'Get project');
  const id = await node.getAttribute('data-id');
  await searchOperations(page, 'Get project');
  for (const width of [1280, 260, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await openCatalog(page);
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Get project');
    await expect(page.getByRole('button', { name: 'Add to workflow: Get project', exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await closeCatalog(page);
    await expect(node).toHaveCount(1);
    await expect(node).toHaveAttribute('data-id', id);
    await expect(workflow(page)).toBeVisible();
  }
});

Then('returning to discovery preserves the graph and a new run starts without stale results', async function () {
  const page = this.page;
  const project = workspace(page).getByRole('textbox', { name: 'Project ID', exact: true });
  await project.fill('project-1');
  await executeOperation(page);
  const body = page.getByRole('region', { name: 'Response body', exact: true });
  await expect(body).toContainText('Documentation');
  await expect(project).toBeDisabled();
  await expect(workspace(page).getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ })).toHaveCount(0);
  await quitRun(page);
  await searchOperations(page, 'Create task');
  await closeCatalog(page);
  await expect(operationNodes(page, 'Get project')).toHaveCount(1);
  await expect(operationNodes(page, 'Create task')).toHaveCount(0);
  await workflowAction(page, 'Run');
  await expect(body).toHaveCount(0);
  await expect(project).toHaveValue('');
  await expect(project).toBeEnabled();
});

Then('actual responses reset with {string} motion when the request changes', async function (motion) {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: motion });
  const body = page.getByRole('region', { name: 'Response body', exact: true });
  await expect(body).toContainText('Documentation');
  await expect(page.getByRole('region', { name: 'Example response', exact: true })).toHaveCount(0);
  await restartRun(page);
  await expect(body).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Project ID', exact: true }).fill('project-2');
  await executeOperation(page);
  await expect(body).toContainText('Website');
  await expect(body).not.toContainText('Documentation');
  await chooseCatalogOperation(page, 'List projects');
  await expect(body).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Documentation');
  await executeOperation(page);
  await expect(body).toContainText('Documentation');
  await expect(body).not.toContainText('Website');
});
