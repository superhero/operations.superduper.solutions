// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { chooseCatalogOperation, closeCatalog, field, fillField, expectFieldValue, openCatalog, workspace } from './workspace.steps.mjs';
import { expectThemeColors } from './theme-colors.mjs';

// Stable role bindings complement independent contrast and state-distinction checks.
const progressRoles = {
  current: ['--color-catalog-active', '--color-catalog-active-foreground'],
  completed: ['--step-complete-background', '--step-complete-foreground'],
  available: ['--step-available-background', '--step-available-foreground'],
  disabled: ['--step-disabled-background', '--step-disabled-foreground']
};

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
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await page.keyboard.press('Tab');
  for (const theme of ['light', 'dark']) {
    await selectTheme(page, theme);
    await page.mouse.move(0, 0);
    const ring = await expectUnclippedFocus(prompt);
    assert.ok(ring.width >= 3 && ring.offset > 0 && ring.radius > 0, 'The prompt needs a strong separated focus ring around rounded corners.');
    await expectThemeColors(prompt, { backgroundColor: '--color-foreground', color: '--color-background', outlineColor: '--color-ring' });
    await expectThemeColors(prompt, { color: '--color-surface' }, '::placeholder');
    for (const badge of await workspace(page).locator('label[for="operation-prompt"], .prompt-suggestions > span:not([hidden])').all())
      await expectThemeColors(badge, { backgroundColor: '--color-badge-background', color: '--color-badge-foreground' });
    const examples = page.locator('.prompt-suggestion-list button:visible');
    for (const example of await examples.all())
      await expectThemeColors(example, { backgroundColor: '--color-muted', color: '--color-chip-foreground' });
    const contrasts = await controlContrasts(workspace(page).locator('textarea, label[for="operation-prompt"], .prompt-suggestions > span:not([hidden]), .prompt-suggestion-list button:visible'));
    for (const { label, minimum, ratio } of contrasts)
      assert.ok(ratio >= minimum, `${theme} ${label} needs readable contrast: ${ratio.toFixed(2)}:1.`);
    await examples.first().hover();
    await expectThemeColors(examples.first(), { backgroundColor: '--color-chip-hover', color: '--color-chip-hover-foreground' });
    for (const { ratio } of await controlContrasts(examples.first()))
      assert.ok(ratio >= 4.5, `${theme} hovered example text needs readable contrast: ${ratio.toFixed(2)}:1.`);
    await page.mouse.move(0, 0);
    await prompt.focus();
  }
  const example = page.locator('.prompt-suggestion-list button:visible').first();
  const suggested = await example.innerText();
  await expect(prompt).toBeFocused();
  await prompt.press('Tab');
  await expect(example).toBeFocused();
  await expectUnclippedFocus(example);
  await example.press('Enter');
  await expect(prompt).toHaveValue(suggested);
  await expect(prompt).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Progress', exact: true }).getByRole('button', { name: /Evaluation$/ })).toBeDisabled();
  await prompt.press('Enter');
  await expectUnclippedFocus(workspace(page).getByRole('heading', { name: 'Evaluation: Listed operations', exact: true }));
  const card = page.locator('.result-card').first();
  const action = card.getByRole('button', { name: /^Go to operation:/ });
  await expectUnclippedFocus(action);
  const actionFits = await action.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const card = element.closest('.result-card').getBoundingClientRect();
    const style = getComputedStyle(element);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return bounds.right + extent <= card.right && bounds.left - extent >= card.left;
  });
  assert.ok(actionFits, 'A result action and its focus outline must fit inside its row.');
  await action.press('Enter');
  const input = workspace(page).locator('.field-input:visible,.field-select-trigger:visible').first();
  await expectUnclippedFocus(input);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

Then('request fields remain readable and preserve accessible editing in both themes', async function () {
  const page = this.page;
  await chooseCatalogOperation(page, 'Create task');
  await expect(workspace(page).getByRole('heading', { name: 'Operation: Create task', exact: true })).toBeVisible();
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
    await expect(workspace(page).getByRole('button', { name: `About ${label}`, exact: true })).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await selectTheme(page, theme);
    await page.mouse.move(0, 0);
    for (const row of await workspace(page).locator('.joined-field').all()) {
      const input = row.locator('.field-input:visible,.field-select-trigger:visible');
      const required = await input.evaluate(element => element.getAttribute('role') === 'combobox' ? element.getAttribute('aria-required') === 'true' : element.required);
      await expectThemeColors(row, { backgroundColor: '--color-foreground' });
      await expectThemeColors(input, { color: '--color-background' });
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
    await expect(await field(page, 'Project ID')).toHaveAccessibleDescription('The identifier of the project to work with.');
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
  await expect(page.getByRole('region', { name: 'Prepared request', exact: true })).toHaveCount(0);
});

Then('result row padding opens the operation while help and keyboard actions remain independent', async function () {
  const page = this.page;
  const card = page.locator('.result-card').filter({ has: page.getByRole('button', { name: 'Go to operation: Get project', exact: true }) });
  const info = card.getByRole('button', { name: 'About Get project', exact: true });
  const evaluation = page.getByRole('navigation', { name: 'Progress', exact: true }).getByRole('button', { name: '2. Evaluation', exact: true });
  await info.click();
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.result-description')).toBeVisible();
  await expect(evaluation).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('region', { name: 'Operation step', exact: true })).toHaveCount(0);
  await info.click();
  await expect(info).toHaveAttribute('aria-expanded', 'false');

  const padding = await card.locator('.result-row').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + parseFloat(getComputedStyle(element).paddingLeft) / 2, y: bounds.top + bounds.height / 2 };
  });
  await page.mouse.click(padding.x, padding.y);
  const operation = page.getByRole('region', { name: 'Operation step', exact: true });
  await expect(operation.getByRole('heading', { name: 'Operation: Get project', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Project ID', exact: true })).toBeFocused();

  await evaluation.click();
  await info.click();
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  const description = card.locator('.result-description');
  await expect(description).toBeVisible();
  const descriptionBounds = await description.boundingBox();
  assert.ok(descriptionBounds, 'The expanded description needs a clickable area.');
  await page.mouse.click(descriptionBounds.x + descriptionBounds.width / 2, descriptionBounds.y + descriptionBounds.height / 2);
  await expect(operation.getByRole('heading', { name: 'Operation: Get project', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Project ID', exact: true })).toBeFocused();

  await evaluation.click();
  const action = card.getByRole('button', { name: 'Go to operation: Get project', exact: true });
  await action.focus();
  await action.press('Enter');
  await expect(operation.getByRole('heading', { name: 'Operation: Get project', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Project ID', exact: true })).toBeFocused();
});

Then('progress colors and navigation states match their roles in both themes', async function () {
  const page = this.page;
  const progress = page.getByRole('navigation', { name: 'Progress', exact: true });
  const prompt = progress.getByRole('button', { name: '1. Prompt', exact: true });
  const evaluation = progress.getByRole('button', { name: '2. Evaluation', exact: true });
  const operation = progress.getByRole('button', { name: '3. Operation', exact: true });
  for (const theme of ['light', 'dark']) {
    // A direct catalog choice makes Operation available without an evaluation.
    await page.reload();
    await chooseCatalogOperation(page, 'Get project');
    await selectTheme(page, theme);
    await expect(operation).toHaveAttribute('aria-current', 'step');
    await expect(evaluation).toBeDisabled();
    await expect(prompt).toBeEnabled();
    await prompt.click();
    await expect(prompt).toHaveAttribute('aria-current', 'step');
    await expect(operation).not.toHaveClass(/is-complete/);
    await page.mouse.move(0, 0);
    const colors = [];
    for (const [button, state] of [[prompt, 'current'], [operation, 'available'], [evaluation, 'disabled']]) {
      await expectThemeColors(button, { color: progressRoles[state][1] });
      await expectThemeColors(button, { backgroundColor: progressRoles[state][0] }, '::before');
      colors.push(await button.evaluate(element => `${getComputedStyle(element, '::before').backgroundColor}/${getComputedStyle(element).color}`));
    }
    assert.equal(new Set(colors).size, 3, `${theme} progress must distinguish current, available and disabled states.`);
    await expectThemeColors(operation, { color: '--color-primary-foreground' });
    await expectThemeColors(operation, { backgroundColor: '--color-primary' }, '::before');

    const input = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await input.fill('Get project');
    await input.press('Enter');
    await expect(evaluation).toHaveAttribute('aria-current', 'step');
    await expect(prompt).toHaveClass(/is-complete/);
    await expect(operation).toBeDisabled();
    await expectThemeColors(prompt, { color: progressRoles.completed[1] });
    await expectThemeColors(prompt, { backgroundColor: progressRoles.completed[0] }, '::before');
    await expectThemeColors(prompt, { color: '--color-background' });
    await expectThemeColors(prompt, { backgroundColor: '--color-foreground' }, '::before');
    const completedColors = await prompt.evaluate(element => `${getComputedStyle(element, '::before').backgroundColor}/${getComputedStyle(element).color}`);
    assert.equal(completedColors, colors[0], `${theme} completed and current steps must share the selected menu colors.`);
    await page.getByRole('button', { name: 'Go to operation: Get project', exact: true }).click();
    await expect(operation).toHaveAttribute('aria-current', 'step');
    await expect(evaluation).toHaveClass(/is-complete/);
    await expectThemeColors(evaluation, { color: progressRoles.completed[1] });
    await expectThemeColors(evaluation, { backgroundColor: progressRoles.completed[0] }, '::before');
  }
});

Then('progress switches between labels and numbers without losing the operation draft', async function () {
  const page = this.page;
  const progress = page.getByRole('navigation', { name: 'Progress', exact: true });
  const names = ['1. Prompt', '2. Evaluation', '3. Operation'];
  const operation = progress.getByRole('button', { name: names[2], exact: true });
  const project = page.getByRole('textbox', { name: 'Project ID', exact: true });
  await project.fill('responsive-draft');
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1280, 260, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(progress.getByRole('button')).toHaveCount(3);
    for (const [index, name] of names.entries())
      await expect(progress.getByRole('button').nth(index)).toHaveAccessibleName(name);
    await expect(progress.locator('.step-label:visible')).toHaveCount(width === 1280 ? 3 : 0);
    await expect(progress.locator('.step-number:visible')).toHaveCount(width === 260 ? 3 : 0);
    await expect(operation).toHaveAttribute('aria-current', 'step');
    await expect(project).toHaveValue('responsive-draft');
    await expect(page.getByRole('region', { name: 'Operation step', exact: true })).toBeVisible();
    assert.ok(await progress.evaluate(element => [...element.querySelectorAll('button')].every(button => {
      const box = button.getBoundingClientRect();
      const content = button.querySelector('.step-content').getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && content.left >= box.left && content.right <= box.right;
    })), 'Every visible step label or number must fit inside its button and viewport.');
  }
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Operation response', exact: true })).toBeVisible();
  await expect(operation).toHaveAttribute('aria-current', 'step');
  await expect(progress.getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: 'Edit inputs', exact: true }).click();
  await expect(project).toHaveValue('responsive-draft');
  await expect(operation).toHaveAttribute('aria-current', 'step');
});

Then('progress hover layering follows its animation through exit and re-entry', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const progress = page.getByRole('navigation', { name: 'Progress', exact: true });
  const control = progress.getByRole('button', { name: '2. Evaluation', exact: true });
  for (const button of await progress.getByRole('button').all()) await expect(button).toBeEnabled();
  await page.mouse.move(0, 0);
  const state = () => control.evaluate(element => {
    const style = getComputedStyle(element);
    return { layer: Number.parseInt(style.zIndex) || 0, scale: style.transform === 'none' ? 1 : new DOMMatrixReadOnly(style.transform).a };
  });
  const idle = await state();
  const finishTransitions = () => control.evaluate(element => {
    for (const animation of element.getAnimations())
      if (animation instanceof CSSTransition) animation.finish();
  });
  const hover = async () => {
    await control.hover();
    await expect.poll(async () => (await state()).scale).toBeGreaterThan(idle.scale);
    await finishTransitions();
    await expect.poll(async () => (await state()).layer).toBeGreaterThan(idle.layer);
  };
  const pauseExit = async () => {
    // Seek the browser's real transitions together at one elapsed time. This
    // preserves delayed stacking changes while avoiding frame-rate dependence.
    await control.evaluate(element => {
      element.__pausedProgressExit = null;
      const capture = event => {
        if (event.target !== element || event.propertyName !== 'transform' || element.matches(':hover')) return;
        const transitions = element.getAnimations().filter(animation => animation instanceof CSSTransition);
        const transform = transitions.find(animation => animation.transitionProperty === 'transform');
        if (!transform) return;
        element.removeEventListener('transitionrun', capture);
        const timing = transform.effect.getTiming();
        const midpoint = timing.delay + Number(timing.duration) / 2;
        for (const transition of transitions) {
          transition.pause();
          transition.currentTime = midpoint;
        }
        element.__pausedProgressExit = transitions;
      };
      element.addEventListener('transitionrun', capture);
    });
    await page.mouse.move(0, 0);
    await expect.poll(() => control.evaluate(element => Boolean(element.__pausedProgressExit))).toBe(true);
    const leaving = await state();
    assert.ok(leaving.scale > idle.scale, 'The check must observe a button that is still shrinking.');
    assert.ok(leaving.layer > idle.layer, 'A shrinking step must remain above adjacent steps until it returns to rest.');
  };

  await hover();
  await pauseExit();
  await finishTransitions();
  await expect.poll(state).toEqual(idle);

  await hover();
  await pauseExit();
  await hover();
  await expect.poll(() => control.evaluate(element => element.matches(':hover'))).toBe(true);
  assert.ok((await state()).layer > idle.layer, 'Re-entering must retain the raised layer after the previous exit is cancelled.');
  await pauseExit();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(state).toEqual(idle);
});

Then('actual responses reset with {string} motion when the request changes', async function (motion) {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: motion });
  const body = page.getByRole('region', { name: 'Response body', exact: true });
  await expect(body).toContainText('Documentation');
  await expect(page.getByRole('region', { name: 'Example response', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit inputs', exact: true }).click();
  await expect(body).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Project ID', exact: true }).fill('project-2');
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  await expect(body).toContainText('Website');
  await expect(body).not.toContainText('Documentation');
  await chooseCatalogOperation(page, 'List projects');
  await expect(body).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Documentation');
  await page.getByRole('button', { name: 'Execute operation', exact: true }).click();
  await expect(body).toContainText('Documentation');
  await expect(body).not.toContainText('Website');
});
