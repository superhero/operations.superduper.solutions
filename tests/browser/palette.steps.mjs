// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { closeCatalog, openCatalog, setMode, searchOperations, setEvaluationDetails } from './workspace.fixture.mjs';
import { selectThemeMode } from './workspace.fixture.mjs';

const paletteNames = ['--palette-1', '--palette-2', '--palette-3', '--palette-4', '--palette-5', '--palette-6'];
const toneNames = ['--tone-1', '--tone-2', '--tone-3', '--tone-4', '--tone-5', '--tone-6'];
const replacement = ['#fff8ed', '#d8cdb8', '#e6ae67', '#994932', '#33465c', '#14202c'];
const paletteOptions = [
  { id: 'default', name: 'Default', selector: ':root' },
  { id: 'graphite-study', name: 'Graphite', selector: ':root[data-palette="graphite-study"]' },
  { id: 'steel-and-mist', name: 'Steel', selector: ':root[data-palette="steel-and-mist"]' },
  { id: 'alpine', name: 'Alpine', selector: ':root[data-palette="alpine"]' },
  { id: 'sunflower', name: 'Cappuccino', selector: ':root[data-palette="sunflower"]' },
  { id: 'bonfire', name: 'Bonfire', selector: ':root[data-palette="bonfire"]' },
  { id: 'obsidian', name: 'Obsidian', selector: ':root[data-palette="obsidian"]' },
  { id: 'heritage-noir', name: 'Heritage Noir', selector: ':root[data-palette="heritage-noir"]' },
  { id: 'carbon', name: 'Carbon', selector: ':root[data-palette="carbon"]' },
  { id: 'midnight-gold', name: 'Midnight Gold', selector: ':root[data-palette="midnight-gold"]' },
  { id: 'harvest-moon', name: 'Harvest Moon', selector: ':root[data-palette="harvest-moon"]' },
  { id: 'neon', name: 'Neon', selector: ':root[data-palette="neon"]' },
  { id: 'rainfall', name: 'Rainfall', selector: ':root[data-palette="rainfall"]' },
  { id: 'autumn', name: 'Autumn', selector: ':root[data-palette="autumn"]' },
  { id: 'sunset', name: 'Sunset', selector: ':root[data-palette="sunset"]' },
  { id: 'golden-violet', name: 'Golden Violet', selector: ':root[data-palette="golden-violet"]' },
  { id: 'garden-dusk', name: 'Garden Dusk', selector: ':root[data-palette="garden-dusk"]' },
  { id: 'blue-horizon', name: 'Blue Horizon', selector: ':root[data-palette="blue-horizon"]' },
  { id: 'spring', name: 'Spring', selector: ':root[data-palette="spring"]' },
  { id: 'lantern', name: 'Lantern', selector: ':root[data-palette="lantern"]' },
  { id: 'citrus', name: 'Citrus', selector: ':root[data-palette="citrus"]' },
];
const settingsDatabaseName = 'v1/settings';

async function storedSettings(page, changes) {
  return page.evaluate(({ databaseName, changes }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const storeName = database.objectStoreNames.contains('settings') ? 'settings' : 'preferences';
      const transaction = database.transaction(storeName, changes ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(storeName);
      if (changes) for (const [key, value] of Object.entries(changes)) {
        if (value === null) store.delete(key);
        else store.put(value, key);
      }
      const theme = store.get('theme');
      const palette = store.get('palette');
      transaction.oncomplete = () => { database.close(); resolve({ theme: theme.result, palette: palette.result }); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), { databaseName: settingsDatabaseName, changes });
}

const legacySettings = page => page.evaluate(() => ({ theme: localStorage.getItem('operations-theme'), palette: localStorage.getItem('operations-palette') }));
const seedLegacySettings = (page, values) => page.evaluate(values => {
  localStorage.setItem('operations-theme', values.theme);
  localStorage.setItem('operations-palette', values.palette);
}, values);
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

const selectTheme = selectThemeMode;

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

async function expectPaletteChoices(page, selected, { structure = true } = {}) {
  const group = paletteGroup(page);
  const theme = settings(page).locator('summary[aria-label="Theme"]');
  if (await theme.getAttribute('aria-expanded') === 'false') await theme.click();
  await expect(theme).toHaveAttribute('aria-expanded', 'true');
  const definitions = new Map((await paletteDefinitions()).map(([, selector, body]) =>
    [selector, [...body.matchAll(/--palette-\d\s*:\s*(#[a-f\d]{6});/gi)].map(match => rgbColor(match[1]))]));
  await expect(group).toBeVisible();
  if (structure) {
    // Preserve computed accessible-name and enabled-state checks in one browser
    // snapshot, without Playwright Test's runner-only snapshot matcher.
    await expect.poll(async () => {
      const choices = [];
      const visit = nodes => {
        for (const node of nodes) {
          if (node.role === 'radio') choices.push({ name: node.name, disabled: node.disabled ?? false, checked: node.checked ?? false });
          if (node.children) visit(node.children);
        }
      };
      visit(await group.ariaSnapshotJSON());
      return choices;
    }).toEqual(paletteOptions.map(({ name }) => ({ name, disabled: false, checked: name === selected })));
    // Read all 126 swatches together while rendering and styles settle.
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
  } else {
    await expect(group.getByRole('radio', { checked: true })).toHaveAccessibleName(selected);
  }
  const selectedPalette = paletteOptions.find(option => option.name === selected);
  assert.ok(selectedPalette, `Unknown palette option: ${selected}`);
  await expect(page.locator('html')).toHaveAttribute('data-palette', selectedPalette.id);
  const palette = await resolvedColors(page, paletteNames);
  assert.deepEqual(paletteNames.map(name => palette[name]), definitions.get(selectedPalette.selector), 'The selected palette must supply the root slots.');
}

async function selectPaletteWithKeyboard(page, name, { enterFromSettings = true } = {}) {
  const theme = await page.locator('html').getAttribute('data-theme');
  if (enterFromSettings) {
    await settings(page).focus();
    await page.keyboard.press('Tab');
    await expect(settings(page).getByRole('switch', { name: 'AI assistant', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(settings(page).getByRole('switch', { name: 'Dark theme', exact: true })).toBeFocused();
    const heading = settings(page).locator('summary[aria-label="Theme"]');
    const sectionCount = await settings(page).locator('summary').count();
    for (let index = 0; index < sectionCount && !await heading.evaluate(element => element === document.activeElement); index++)
      await page.keyboard.press('Tab');
    await expect(heading).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(paletteGroup(page).getByRole('radio', { checked: true })).toBeFocused();
  } else {
    // Tab entry is covered by the initial selection; repeat only native radio navigation.
    await paletteGroup(page).getByRole('radio', { checked: true }).focus();
  }
  const choice = paletteChoice(page, name);
  const wraps = page.context().browser().browserType().name() !== 'webkit';
  const route = await paletteGroup(page).getByRole('radio').evaluateAll((inputs, { name, wraps }) => {
    const current = inputs.findIndex(input => input.checked);
    const target = inputs.findIndex(input => input.getAttribute('aria-label') === name);
    if (current < 0 || target < 0) throw new Error('The selected and requested palettes must exist.');
    // WebKit's native radios stop at group ends instead of wrapping.
    if (!wraps) return { key: target < current ? 'ArrowLeft' : 'ArrowRight', steps: Math.abs(target - current) };
    const forward = (target - current + inputs.length) % inputs.length;
    const backward = (current - target + inputs.length) % inputs.length;
    return forward <= backward ? { key: 'ArrowRight', steps: forward } : { key: 'ArrowLeft', steps: backward };
  }, { name, wraps });
  // Keep real keyboard traversal using the engine's native group behavior,
  // avoiding a full loop when a wrapping engine can move one step left.
  for (let step = 0; step < route.steps; step++) await page.keyboard.press(route.key);
  await expect(choice).toBeFocused();
  await page.keyboard.press('Space');
  await expect(choice).toBeChecked();
  // WebKit establishes :focus-visible on Space, not native arrow navigation.
  assert.ok(await choice.evaluate(element => element.matches(':focus-visible')), 'The activated palette choice must show keyboard focus.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

Then('Settings offers all palettes with {string} selected', async function (selected) {
  await expectPaletteChoices(this.page, selected);
});

When('I select the {string} palette with the keyboard', async function (name) {
  await selectPaletteWithKeyboard(this.page, name);
});

Then('{string} and theme settings persist independently after reloading', async function (selected) {
  const page = this.page;
  const selectedPalette = paletteOptions.find(option => option.name === selected);
  assert.ok(selectedPalette, `Unknown palette option: ${selected}`);
  for (const theme of ['dark', 'light']) {
    await selectTheme(page, theme);
    // Check every preview once per mode; selection and reload checks below only
    // need the selected radio and the active root palette.
    await expectPaletteChoices(page, selected);
    for (const name of ['Default', selected]) {
      await selectPaletteWithKeyboard(page, name, { enterFromSettings: false });
      await expectPaletteChoices(page, name, { structure: false });
    }
    await expect.poll(() => storedSettings(page)).toEqual({ palette: selectedPalette.id, theme });
    assert.deepEqual(await legacySettings(page), { theme: null, palette: null });
    await page.reload();
    await setMode(page, 'settings');
    await expectPaletteChoices(page, selected, { structure: false });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
});

When('I reload with an {string} palette setting', async function (setting) {
  if (setting === 'unknown') {
    await storedSettings(this.page, { palette: 'unknown-palette' });
  } else {
    assert.equal(setting, 'unavailable');
    this.paletteStorageUnavailable = true;
    await this.page.evaluate(() => localStorage.setItem('v1/settings/appearance-cache',
      JSON.stringify({ version: 1, theme: 'dark', palette: 'sunset' })));
    await this.page.addInitScript(databaseName => {
      const original = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, ...args) {
        if (name === databaseName) throw new DOMException('Test settings storage unavailable', 'SecurityError');
        return original.call(this, name, ...args);
      };
    }, settingsDatabaseName);
  }
  await this.page.reload();
  if (setting === 'unknown')
    await expect.poll(async () => (await storedSettings(this.page)).palette).toBe('default');
  else {
    assert.deepEqual(await this.page.evaluate(() => JSON.parse(localStorage.getItem('v1/settings/appearance-cache'))),
      { version: 1, theme: 'dark', palette: 'sunset' }, 'Unavailable IndexedDB must retain the last confirmed appearance cache.');
    await expect.poll(() => this.diagnostics.filter(expectedUnavailableSettingsError).length).toBeGreaterThan(0);
    this.diagnostics = this.diagnostics.filter(item => !expectedUnavailableSettingsError(item));
  }
});

const expectedUnavailableSettingsError = item => item.type === 'console-error'
  && item.message.includes('SettingsStorageError') && item.message.includes('Test settings storage unavailable');

Then('representative palettes remain usable in both theme modes', async function () {
  for (const theme of ['dark', 'light']) {
    await selectTheme(this.page, theme);
    for (const name of ['Default', 'Sunset', 'Graphite']) {
      await selectPaletteWithKeyboard(this.page, name);
      await expectPaletteChoices(this.page, name);
    }
    await expect(this.page.locator('html')).toHaveAttribute('data-theme', theme);
  }
  if (this.paletteStorageUnavailable) {
    await expect.poll(() => this.diagnostics.filter(expectedUnavailableSettingsError).length).toBeGreaterThan(0);
    this.diagnostics = this.diagnostics.filter(item => !expectedUnavailableSettingsError(item));
  }
});

Then('the version-one preferences store remains readable and writable without an upgrade', async function () {
  const page = this.page;
  const fixtureUrl = `${this.baseURL}/settings-legacy-fixture`;
  await page.route(fixtureUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Legacy settings fixture</title>' }));
  // Leave the application first so its open database connection cannot block the fixture.
  await page.goto(fixtureUrl);
  await page.evaluate(async databaseName => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = resolve;
      request.onerror = request.onblocked = () => reject(request.error ?? new Error('Settings fixture deletion blocked'));
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('preferences');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('preferences', 'readwrite');
        const store = transaction.objectStore('preferences');
        store.put('dark', 'theme');
        store.put('sunset', 'palette');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    });
  }, settingsDatabaseName);
  await page.goto(this.baseURL);
  for (let load = 0; load < 2; load++) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'sunset');
    assert.deepEqual(await storedSettings(page), { theme: 'dark', palette: 'sunset' });
    if (load === 0) await page.reload();
  }
  await setMode(page, 'settings');
  await expectPaletteChoices(page, 'Sunset');
  await selectPaletteWithKeyboard(page, 'Alpine');
  await expect.poll(() => storedSettings(page)).toEqual({ theme: 'dark', palette: 'alpine' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'alpine');
  const schema = await page.evaluate(databaseName => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const result = { version: database.version, stores: [...database.objectStoreNames] };
      database.close();
      resolve(result);
    };
  }), settingsDatabaseName);
  assert.deepEqual(schema, { version: 1, stores: ['preferences'] });
});

Then('the legacy theme and palette migrate without retaining localStorage copies', async function () {
  const page = this.page;
  await storedSettings(page, { theme: null, palette: null });
  await seedLegacySettings(page, { theme: 'dark', palette: 'sunset' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sunset');
  await expect.poll(() => storedSettings(page)).toEqual({ theme: 'dark', palette: 'sunset' });
  await expect.poll(() => legacySettings(page)).toEqual({ theme: null, palette: null });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sunset');
  assert.deepEqual(await storedSettings(page), { theme: 'dark', palette: 'sunset' });
});

Then('IndexedDB settings remain authoritative during per-key migration', async function () {
  const page = this.page;
  await storedSettings(page, { theme: 'dark', palette: null });
  await seedLegacySettings(page, { theme: 'light', palette: 'alpine' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'alpine');
  await expect.poll(() => storedSettings(page)).toEqual({ theme: 'dark', palette: 'alpine' });
  await storedSettings(page, { palette: 'graphite-study' });
  await seedLegacySettings(page, { theme: 'light', palette: 'sunset' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'graphite-study');
  assert.deepEqual(await storedSettings(page), { theme: 'dark', palette: 'graphite-study' });
  await expect.poll(() => legacySettings(page)).toEqual({ theme: null, palette: null });
});

Then('rapid settings changes retain the final theme and palette after reloading', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await expectPaletteChoices(page, 'Default');
  await page.evaluate(async () => {
    const toggle = document.querySelector('[role="switch"][aria-label="Dark theme"]');
    for (const palette of ['alpine', 'sunset', 'graphite-study', 'default', 'sunset']) {
      document.querySelector(`input[name="color-palette"][value="${palette}"]`).click();
      toggle.click();
      await Promise.resolve();
    }
  });
  await expect.poll(() => storedSettings(page)).toEqual({ theme: 'dark', palette: 'sunset' });
  assert.deepEqual(await legacySettings(page), { theme: null, palette: null });
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect.poll(() => storedSettings(page)).toEqual({ theme: 'dark', palette: 'sunset' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await setMode(page, 'settings');
  await expectPaletteChoices(page, 'Sunset');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

Then('later storage readers see every queued appearance change', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await expectPaletteChoices(page, 'Default');
  const saved = await page.evaluate(async databaseName => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const storeName = database.objectStoreNames.contains('settings') ? 'settings' : 'preferences';
      // Native contention keeps the first save pending while all choices arrive.
      // A subsequent reader must wait for the entire burst, not its first write.
      const blocker = database.transaction(storeName, 'readwrite');
      blocker.objectStore(storeName).get('theme');
      const toggle = document.querySelector('[role="switch"][aria-label="Dark theme"]');
      for (const palette of ['alpine', 'sunset', 'graphite-study', 'default', 'sunset']) {
        document.querySelector(`input[name="color-palette"][value="${palette}"]`).click();
        toggle.click();
        await Promise.resolve();
      }
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const theme = store.get('theme'), palette = store.get('palette');
        transaction.oncomplete = () => resolve({ theme: theme.result, palette: palette.result });
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }, settingsDatabaseName);
  assert.deepEqual(saved, { theme: 'dark', palette: 'sunset' });
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  assert.deepEqual(await storedSettings(page), saved);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sunset');
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
    let surface = element;
    while (surface.parentElement && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
    return { foreground: style.color, background: getComputedStyle(surface).backgroundColor };
  });
  for (const [role, color] of Object.entries(colors))
    assert.ok(palette.includes(color), `${role} must use an opaque palette color: ${color}`);
  const values = Object.values(colors).map(luminance).sort((a, b) => a - b);
  const ratio = (values[1] + 0.05) / (values[0] + 0.05);
  assert.ok(ratio >= 4.5, `${await control.getAttribute('class')} text contrast must reach 4.5:1; got ${ratio.toFixed(2)}:1.`);
}

Then('prompt fields and badges remain readable while primary actions use the label foreground in both modes', async function () {
  const page = this.page;
  await setEvaluationDetails(page);
  for (const theme of ['light', 'dark']) {
    await selectTheme(page, theme);
    const palette = Object.values(await resolvedColors(page, paletteNames));
    await setMode(page, 'workflow');
    await openCatalog(page);
    await expectReadable(page.getByRole('textbox', { name: 'Prompt', exact: true }), palette);
    await searchOperations(page, 'Example object response');
    await expectReadable(page.getByRole('button', { name: 'Review matching details', exact: true }), palette);
    await setMode(page, 'workflow');
    const primary = page.locator('.workflow-empty').getByRole('button', { name: 'Browse operations', exact: true })
      .and(page.locator('[data-slot="button"]'));
    // Primary action labels intentionally use the label color selected by the theme.
    const roles = await resolvedColors(page, ['--color-primary', '--color-badge-background']);
    await expect(primary).toBeVisible();
    await expect(primary).toHaveCSS('background-color', roles['--color-primary']);
    await expect(primary).toHaveCSS('color', roles['--color-badge-background']);
  }
});
