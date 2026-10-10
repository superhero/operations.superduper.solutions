// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { closeCatalog, openCatalog, setMode } from './workspace.steps.mjs';

const paletteNames = Array.from({ length: 6 }, (_, index) => `--palette-${index + 1}`);
const toneNames = Array.from({ length: 6 }, (_, index) => `--tone-${index + 1}`);
const replacement = ['#fff8ed', '#d8cdb8', '#e6ae67', '#994932', '#33465c', '#14202c'];
const paletteOptions = [
  { id: 'default', name: 'Default', selector: ':root' },
  { id: 'sunset', name: 'Sunset', selector: ':root[data-palette="sunset"]' },
  { id: 'alpine', name: 'Alpine', selector: ':root[data-palette="alpine"]' },
  { id: 'obsidian', name: 'Obsidian', selector: ':root[data-palette="obsidian"]' },
  { id: 'midnight-gold', name: 'Midnight Gold', selector: ':root[data-palette="midnight-gold"]' },
  { id: 'neon', name: 'Neon', selector: ':root[data-palette="neon"]' },
  { id: 'lantern', name: 'Lantern', selector: ':root[data-palette="lantern"]' },
  { id: 'spring', name: 'Spring', selector: ':root[data-palette="spring"]' },
  { id: 'bonfire', name: 'Bonfire', selector: ':root[data-palette="bonfire"]' },
  { id: 'harvest-moon', name: 'Harvest Moon', selector: ':root[data-palette="harvest-moon"]' },
  { id: 'blue-horizon', name: 'Blue Horizon', selector: ':root[data-palette="blue-horizon"]' },
  { id: 'golden-violet', name: 'Golden Violet', selector: ':root[data-palette="golden-violet"]' },
  { id: 'citrus', name: 'Citrus', selector: ':root[data-palette="citrus"]' },
  { id: 'sunflower', name: 'Cappuccino', selector: ':root[data-palette="sunflower"]' },
  { id: 'garden-dusk', name: 'Garden Dusk', selector: ':root[data-palette="garden-dusk"]' },
  { id: 'autumn', name: 'Autumn', selector: ':root[data-palette="autumn"]' },
  { id: 'rainfall', name: 'Rainfall', selector: ':root[data-palette="rainfall"]' },
  { id: 'graphite-study', name: 'Graphite', selector: ':root[data-palette="graphite-study"]' },
  { id: 'steel-and-mist', name: 'Steel', selector: ':root[data-palette="steel-and-mist"]' },
  { id: 'carbon', name: 'Carbon', selector: ':root[data-palette="carbon"]' },
  { id: 'heritage-noir', name: 'Heritage Noir', selector: ':root[data-palette="heritage-noir"]' },
];
const paletteStorageKey = 'operations-palette';
const settings = page => page.getByRole('region', { name: 'Settings workspace', exact: true });
const paletteGroup = page => settings(page).getByRole('group', { name: 'Color palette', exact: true });
const paletteChoice = (page, name) => paletteGroup(page).getByRole('radio', { name, exact: true });
const rgbColor = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ')})`;

async function paletteDefinitions() {
  const source = await readFile('src/palette.css', 'utf8');
  return [...source.matchAll(/(:root(?:\[data-palette=[^\]]+\])?)\s*\{([^{}]*)\}/g)];
}

function luminance(color) {
  const channels = color.startsWith('#')
    ? color.slice(1).match(/../g).map(value => parseInt(value, 16))
    : color.match(/[\d.]+/g).map(Number);
  assert.equal(channels.length, 3, `An ordinary theme color must be opaque: ${color}`);
  return channels.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

// These adjacent pairs retain the user's explicit color-slot choices.
const curatedSlotInversions = {
  ':root[data-palette="neon"]': [2],
  ':root[data-palette="citrus"]': [4],
};

function assertOrdered(colors, selector = ':root') {
  assert.equal(new Set(colors).size, 6, 'A palette must have six distinct colors.');
  const values = colors.map(luminance);
  for (let index = 1; index < values.length; index++) {
    if (curatedSlotInversions[selector]?.includes(index)) continue;
    assert.ok(values[index - 1] > values[index], `${selector} palette slot ${index} must be lighter than slot ${index + 1}.`);
  }
}

async function selectTheme(page, theme) {
  await openCatalog(page);
  const toggle = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await toggle.getAttribute('aria-checked') !== String(theme === 'dark')) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await closeCatalog(page);
}

async function resolvedColors(page, names) {
  return page.evaluate(properties => {
    // A real element resolves CSS variables without canvas fingerprinting defenses.
    const probe = document.createElement('span');
    document.documentElement.append(probe);
    try {
      return Object.fromEntries(properties.map(name => {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        if (!value || !CSS.supports('color', value)) throw new Error(`Missing or invalid theme color ${name}: ${value}`);
        probe.style.color = value;
        return [name, getComputedStyle(probe).color];
      }));
    } finally {
      probe.remove();
    }
  }, names);
}

async function expectPaletteChoices(page, selected) {
  const group = paletteGroup(page);
  const theme = settings(page).locator('summary[aria-label="Theme"]');
  if (await theme.getAttribute('aria-expanded') === 'false') await theme.click();
  await expect(theme).toHaveAttribute('aria-expanded', 'true');
  const definitions = new Map((await paletteDefinitions()).map(([, selector, body]) =>
    [selector, [...body.matchAll(/--palette-\d\s*:\s*(#[a-f\d]{6});/gi)].map(match => rgbColor(match[1]))]));
  await expect(group).toBeVisible();
  // Exact role/name locators retain accessible-name and enabled-state checks
  // without the snapshot matcher, which requires the Playwright test runner.
  await Promise.all(paletteOptions.map(({ name }) => expect(paletteChoice(page, name)).toBeEnabled()));
  // Read all 126 swatches together: this helper runs repeatedly for every palette.
  // Keep retrying the complete DOM state while rendering and styles settle.
  await expect.poll(() => group.getByRole('radio').evaluateAll(inputs => inputs.map(input => {
    const preview = input.closest('label')?.querySelector('[data-palette-preview]');
    return {
      id: input.value,
      type: input.getAttribute('type'),
      checked: input.checked,
      preview: preview?.getAttribute('data-palette-preview'),
      swatches: [...(preview?.children ?? [])].filter(element => !element.matches(".palette-selected-icon")).map(element => {
        const bounds = element.getBoundingClientRect();
        return {
          visible: element.checkVisibility({ visibilityProperty: true }) && bounds.width > 0 && bounds.height > 0,
          color: getComputedStyle(element).backgroundColor,
        };
      }),
    };
  })), { message: 'Every enabled palette choice must preview its own six visible colors in order.' }).toEqual(
    paletteOptions.map(({ id, name, selector }) => ({
      id, type: 'radio', checked: name === selected, preview: id,
      swatches: definitions.get(selector).map(color => ({ visible: true, color })),
    })),
  );
  const selectedPalette = paletteOptions.find(option => option.name === selected);
  assert.ok(selectedPalette, `Unknown palette option: ${selected}`);
  await expect(page.locator('html')).toHaveAttribute('data-palette', selectedPalette.id);
  const palette = await resolvedColors(page, paletteNames);
  assert.deepEqual(paletteNames.map(name => palette[name]), definitions.get(selectedPalette.selector), 'The selected palette must supply the root slots.');
}

async function selectPaletteWithKeyboard(page, name) {
  const theme = await page.locator('html').getAttribute('data-theme');
  await settings(page).focus();
  await page.keyboard.press('Tab');
  await expect(settings(page).locator('summary[aria-label="Theme"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(paletteGroup(page).getByRole('radio', { checked: true })).toBeFocused();
  const choice = paletteChoice(page, name);
  for (let step = 0; step < paletteOptions.length && !await choice.isChecked(); step++)
    await page.keyboard.press('ArrowRight');
  await expect(choice).toBeFocused();
  assert.ok(await choice.evaluate(element => element.matches(':focus-visible')), 'The palette choice must receive keyboard focus.');
  await page.keyboard.press('Space');
  await expect(choice).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

Then('Settings offers all palettes with {string} selected', async function (selected) {
  await expectPaletteChoices(this.page, selected);
});

When('I select the {string} palette with the keyboard', async function (name) {
  await selectPaletteWithKeyboard(this.page, name);
});

Then('{string} and theme preferences persist independently after reloading', async function (selected) {
  const page = this.page;
  const selectedPalette = paletteOptions.find(option => option.name === selected);
  assert.ok(selectedPalette, `Unknown palette option: ${selected}`);
  for (const theme of ['dark', 'light']) {
    await selectTheme(page, theme);
    await expectPaletteChoices(page, selected);
    for (const name of ['Default', selected]) {
      await selectPaletteWithKeyboard(page, name);
      await expectPaletteChoices(page, name);
    }
    await expect.poll(() => page.evaluate(key => ({
      palette: localStorage.getItem(key), theme: localStorage.getItem('operations-theme'),
    }), paletteStorageKey)).toEqual({ palette: selectedPalette.id, theme });
    await page.reload();
    await setMode(page, 'settings');
    await expectPaletteChoices(page, selected);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
});

When('I reload with an {string} palette preference', async function (preference) {
  if (preference === 'unknown') {
    await this.page.evaluate(key => localStorage.setItem(key, 'unknown-palette'), paletteStorageKey);
  } else {
    assert.equal(preference, 'unavailable');
    await this.page.addInitScript(key => {
      for (const method of ['getItem', 'setItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (name, ...args) {
          if (name === key) throw new DOMException('Test palette storage unavailable', 'SecurityError');
          return original.call(this, name, ...args);
        };
      }
    }, paletteStorageKey);
  }
  await this.page.reload();
  if (preference === 'unknown')
    await expect.poll(() => this.page.evaluate(key => localStorage.getItem(key), paletteStorageKey)).toBe('default');
});

Then('all palettes remain usable in both theme modes', { timeout: 60_000 }, async function () {
  for (const theme of ['dark', 'light']) {
    await selectTheme(this.page, theme);
    for (const { name } of paletteOptions) {
      await selectPaletteWithKeyboard(this.page, name);
      await expectPaletteChoices(this.page, name);
    }
    await expect(this.page.locator('html')).toHaveAttribute('data-theme', theme);
  }
});

When('I replace only the six ordered palette colors', async function () {
  assertOrdered(replacement);
  await this.page.evaluate(({ names, colors }) => {
    names.forEach((name, index) => document.documentElement.style.setProperty(name, colors[index]));
  }, { names: paletteNames, colors: replacement });
});

Then('every ordinary theme color reverses its position in the six-color palette', async function () {
  const paletteBlocks = await paletteDefinitions();
  assert.ok(paletteBlocks.some(match => match[1] === ':root'), 'A default palette must be defined.');
  for (const [, selector, body] of paletteBlocks) {
    const declarations = [...body.matchAll(/(--palette-[\w-]+)\s*:\s*([^;]+);/g)];
    assert.deepEqual(declarations.map(match => match[1]), paletteNames, `${selector} must supply all six ordered palette slots.`);
    const literals = declarations.map(match => match[2].trim());
    for (const color of literals) assert.match(color, /^#[a-f\d]{6}$/i, `${selector} inputs must be literal hex colors.`);
    assertOrdered(literals, selector);
  }

  const appSource = await readFile('src/app.css', 'utf8');
  const roles = [...appSource.matchAll(/^[\t ]*(--(?:color|control|step)-[\w-]+)\s*:/gm)]
    .map(match => match[1]).filter(name => name !== '--color-invalid-ring');
  assert.ok(roles.includes('--color-background') && roles.includes('--control-addon') && roles.includes('--step-complete-background'));
  assert.equal(new Set(roles).size, roles.length, 'Semantic roles must be defined once, without mode-specific exceptions.');

  await selectTheme(this.page, 'light');
  const light = await resolvedColors(this.page, [...paletteNames, ...toneNames, ...roles]);
  const palette = paletteNames.map(name => light[name]);
  const selectedId = await this.page.locator('html').getAttribute('data-palette');
  assertOrdered(palette, paletteOptions.find(option => option.id === selectedId)?.selector);
  for (const [index, tone] of toneNames.entries()) assert.equal(light[tone], palette[index], `${tone} in light mode`);
  for (const role of roles) assert.ok(palette.includes(light[role]), `${role} must use one exact palette color in light mode: ${light[role]}`);

  await selectTheme(this.page, 'dark');
  const dark = await resolvedColors(this.page, [...paletteNames, ...toneNames, ...roles]);
  assert.deepEqual(paletteNames.map(name => dark[name]), palette, 'Switching modes must preserve the palette itself.');
  for (const [index, tone] of toneNames.entries()) assert.equal(dark[tone], palette[5 - index], `${tone} in dark mode`);
  for (const role of roles)
    assert.equal(dark[role], palette[5 - palette.indexOf(light[role])], `${role} must reverse its palette position in dark mode.`);
});

async function expectReadable(control, palette) {
  await expect(control).toBeVisible();
  const colors = await control.evaluate(element => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  for (const [role, color] of Object.entries(colors))
    assert.ok(palette.includes(color), `${role} must use an opaque palette color: ${color}`);
  const values = Object.values(colors).map(luminance).sort((a, b) => a - b);
  const ratio = (values[1] + 0.05) / (values[0] + 0.05);
  assert.ok(ratio >= 4.5, `${await control.getAttribute('class')} text contrast must reach 4.5:1; got ${ratio.toFixed(2)}:1.`);
}

Then('prompt fields and badges remain readable while primary actions use the label foreground in both modes', async function () {
  const page = this.page;
  for (const theme of ['light', 'dark']) {
    await selectTheme(page, theme);
    const palette = Object.values(await resolvedColors(page, paletteNames));
    await setMode(page, 'operations');
    await expectReadable(page.getByRole('textbox', { name: 'Prompt', exact: true }), palette);
    await expectReadable(page.locator('label[for="operation-prompt"]'), palette);
    await setMode(page, 'workflow');
    const primary = page.getByRole('button', { name: 'Add operations from the left menu', exact: true })
      .and(page.locator('[data-slot="button"]'));
    // Primary action labels intentionally use the label color selected by the theme.
    const roles = await resolvedColors(page, ['--color-primary', '--color-badge-background']);
    await expect(primary).toBeVisible();
    await expect(primary).toHaveCSS('background-color', roles['--color-primary']);
    await expect(primary).toHaveCSS('color', roles['--color-badge-background']);
  }
});
