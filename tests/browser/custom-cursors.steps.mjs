// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect, firefox, webkit } from '@playwright/test';
import { closeCatalog, openCatalog, readExport, setMode, workflow } from './workspace.steps.mjs';
import { center, gesture } from './workflow-single-input.steps.mjs';

const cacheKey = 'v1/settings/appearance-cache';
const roles = ['default', 'pointer', 'text', 'not-allowed', 'grab', 'grabbing', 'crosshair', 'ew-resize', 'ns-resize'];
const settings = page => page.getByRole('region', { name: 'Settings workspace', exact: true, includeHidden: true });
const toggle = page => settings(page).getByRole('switch', { name: 'Custom cursors', exact: true, includeHidden: true });
const cursorValues = page => page.evaluate(roles => Object.fromEntries(roles.map(role =>
  [role, document.documentElement.style.getPropertyValue(`--cursor-${role}`).trim()])), roles);
const cache = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), cacheKey);

async function storedCursor(page, change) {
  return page.evaluate(({ write, change }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const name = database.objectStoreNames.contains('settings') ? 'settings' : 'preferences';
      const transaction = database.transaction(name, write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(name);
      if (write) {
        if (change === null) store.delete('customCursors');
        else store.put(change, 'customCursors');
      }
      const value = store.get('customCursors');
      transaction.oncomplete = () => { database.close(); resolve(value.result); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), { write: arguments.length > 1, change });
}

async function openSection(page, name) {
  await setMode(page, 'settings');
  const heading = settings(page).locator(`summary[aria-label="${name}"]`);
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
}

async function enableCursors(page, enabled) {
  await openSection(page, 'Theme');
  if (await toggle(page).getAttribute('aria-checked') !== String(enabled)) await toggle(page).click();
  await expectCursorPreference(page, enabled);
}

async function expectCursorPreference(page, enabled) {
  await expect(page.locator('html')).toHaveAttribute('data-custom-cursors', String(enabled));
  await expect(toggle(page)).toHaveAttribute('aria-checked', String(enabled));
  await expect.poll(async () => Object.values(await cursorValues(page)).every(value => enabled ? value.startsWith('url(') : value === '')).toBe(true);
}

async function expectCursor(locator, role, enabled) {
  if (!enabled) return expect(locator).toHaveCSS('cursor', role);
  const expected = await locator.evaluate((element, role) => {
    const probe = document.createElement('span');
    probe.style.cursor = getComputedStyle(document.documentElement).getPropertyValue(`--cursor-${role}`);
    document.body.append(probe);
    const value = getComputedStyle(probe).cursor;
    probe.remove();
    return value;
  }, role);
  assert.match(expected, /^url\("data:image\/svg\+xml,/);
  assert.ok(expected.endsWith(`, ${role}`), `The custom cursor must retain its ${role} fallback.`);
  await expect(locator).toHaveCSS('cursor', expected);
}

async function theme(page, dark) {
  await openCatalog(page);
  const control = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await control.getAttribute('aria-checked') !== String(dark)) await control.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
  await closeCatalog(page);
}

async function expectEmbeddedArtwork(page) {
  const values = await cursorValues(page);
  for (const [role, value] of Object.entries(values)) {
    const match = /^url\("(data:image\/svg\+xml,[^"]+)"\) (\d+) (\d+), ([\w-]+)$/.exec(value);
    assert.ok(match, `${role} must embed an SVG with an explicit hotspot and native fallback.`);
    assert.equal(match[4], role);
    const image = await page.evaluate(async url => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, match[1]);
    assert.ok(image.width > 0 && image.width <= 128 && image.height > 0 && image.height <= 128);
    assert.ok(Number(match[2]) < image.width && Number(match[3]) < image.height, `${role} hotspot must lie within its embedded image.`);
  }
}

Then('custom cursors default on with embedded artwork and exact native fallbacks', async function () {
  const page = this.page;
  await openSection(page, 'Theme');
  await expectCursorPreference(page, true);
  assert.equal((await storedCursor(page)) ?? true, true, 'An absent setting defaults to enabled without requiring a database write.');
  await expectEmbeddedArtwork(page);
});

Then('turning custom cursors off preserves native text behavior and unrelated styles', async function () {
  const page = this.page;
  await page.evaluate(() => {
    window.cursorDocumentMarker = 'cursor-review-document';
    document.documentElement.style.setProperty('--cursor-review-marker', 'preserved');
  });
  await expectCursor(toggle(page), 'pointer', true);
  await toggle(page).focus();
  await page.keyboard.press('Space');
  await expectCursorPreference(page, false);
  await expect(toggle(page)).toBeFocused();
  assert.equal(await page.evaluate(() => window.cursorDocumentMarker), 'cursor-review-document', 'Changing cursor appearance must not reload the document.');
  assert.equal(await page.locator('html').evaluate(root => root.style.getPropertyValue('--cursor-review-marker')), 'preserved');
  await expectCursor(toggle(page), 'pointer', false);
  const nativeTextCursor = await page.getByRole('textbox', { name: 'Prompt', exact: true, includeHidden: true })
    .evaluate(element => getComputedStyle(element).cursor);
  assert.match(nativeTextCursor, /^(auto|text)$/);
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'cursor-link-review';
    fixture.style.cssText = 'position: fixed; bottom: 0; pointer-events: none';
    const link = document.createElement('a');
    link.href = '#cursor-link-review';
    link.textContent = 'Cursor review link';
    const plain = document.createElement('a');
    plain.textContent = 'Cursor review anchor';
    fixture.append(link, plain);
    document.body.append(fixture);
  });
  for (const enabled of [true, false]) {
    await enableCursors(page, enabled);
    await setMode(page, 'operations');
    await expect(page.locator('html')).toHaveCSS('cursor', 'auto');
    await expect(page.locator('body')).toHaveCSS('cursor', 'auto');
    await expect(page.locator('.site-header .brand')).toHaveCSS('cursor', 'auto');
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveCSS('cursor', nativeTextCursor);
    await expectCursor(page.getByRole('link', { name: 'Cursor review link', exact: true }), 'pointer', enabled);
    await expect(page.locator('#cursor-link-review a:not([href])')).toHaveCSS('cursor', 'auto');
    await setMode(page, 'workflow');
    const disabled = workflow(page).getByRole('button', { name: 'Undo', exact: true });
    await expect(disabled).toBeDisabled();
    await expectCursor(disabled, 'not-allowed', enabled);
  }
  await page.locator('#cursor-link-review').evaluate(element => element.remove());
});

Then('the cursor preference survives reloading in both states', async function () {
  const page = this.page;
  for (const enabled of [false, true]) {
    await enableCursors(page, enabled);
    await expect.poll(() => storedCursor(page)).toBe(enabled);
    await expect.poll(async () => (await cache(page)).customCursors).toBe(enabled);
    await page.reload();
    await openSection(page, 'Theme');
    await expectCursorPreference(page, enabled);
  }
});

Then('cursor artwork follows the current foreground and background in both theme modes', async function () {
  const page = this.page;
  await openSection(page, 'Theme');
  let previous;
  for (const [dark, palette] of [[false, 'Default'], [true, 'Default'], [true, 'Sunset'], [false, 'Sunset']]) {
    await theme(page, dark);
    await settings(page).getByRole('radio', { name: palette, exact: true }).check();
    await expect.poll(async () => {
      const values = await cursorValues(page);
      const colors = await page.locator('html').evaluate(root => {
        const style = getComputedStyle(root);
        return ['--color-foreground', '--color-background'].map(key => style.getPropertyValue(key).trim());
      });
      return Object.values(values).every(value => {
        const url = /^url\("([^"]+)"\)/.exec(value)?.[1];
        const svg = url ? decodeURIComponent(url.slice('data:image/svg+xml,'.length)) : '';
        return colors.every(color => svg.includes(color));
      });
    }).toBe(true);
    const current = await cursorValues(page);
    if (previous) assert.notDeepEqual(current, previous, 'Changing mode or palette must refresh cursor artwork.');
    previous = current;
    await page.mouse.move(40, 40);
    await page.mouse.move(80, 80, { steps: 3 });
    assert.deepEqual(await cursorValues(page), current, 'Pointer movement must leave the rendered cursor palette intact.');
  }
});

Given('I reload with a {string} cursor cache and a {string} database value', async function (hint, stored) {
  const page = this.page;
  this.cursorStoredSeed = stored === 'missing' ? undefined : stored === 'invalid' ? 'false' : stored === 'true';
  await storedCursor(page, this.cursorStoredSeed ?? null);
  await page.evaluate(({ key, hint }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, theme: 'light', palette: 'default',
      ...(hint === 'legacy' ? {} : { customCursors: hint === 'true' }) }));
  }, { key: cacheKey, hint });
  await page.addInitScript(() => {
    const observer = new MutationObserver(records => {
      const change = records.find(record => record.attributeName === 'data-custom-cursors');
      if (change && window.cursorFirstPreference === undefined) {
        window.cursorFirstPreference = change.target.getAttribute('data-custom-cursors');
        observer.disconnect();
      }
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-custom-cursors'] });
  });
  await page.reload();
});

Then('the first cursor preference is {string} and the confirmed preference is {string}', async function (first, confirmed) {
  const page = this.page;
  assert.equal(await page.evaluate(() => window.cursorFirstPreference), first, 'The inline bootstrap must use the cache before application reconciliation.');
  await openSection(page, 'Theme');
  await expectCursorPreference(page, confirmed === 'true');
  assert.equal(await storedCursor(page), this.cursorStoredSeed, 'The cache must never import its hint into IndexedDB.');
  await expect.poll(async () => (await cache(page)).customCursors).toBe(confirmed === 'true');
});

const expectedStorageError = item => item.type === 'console-error' && item.message.includes('SettingsStorageError')
  && item.message.includes('Cursor review storage unavailable');

async function consumeStorageErrors(world) {
  await expect.poll(() => world.diagnostics.filter(expectedStorageError).length).toBeGreaterThan(0);
  world.diagnostics = world.diagnostics.filter(item => !expectedStorageError(item));
}

Then('a failed cursor save keeps the confirmed cache and retries the latest choice', async function () {
  const page = this.page;
  await openSection(page, 'Theme');
  await enableCursors(page, false);
  await expect.poll(() => storedCursor(page)).toBe(false);
  await enableCursors(page, true);
  await expect.poll(() => storedCursor(page)).toBe(true);
  const confirmed = await cache(page);
  await page.evaluate(() => {
    window.cursorOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (this.name === 'v1/settings' && mode === 'readwrite') throw new Error('Cursor review storage unavailable');
      return window.cursorOriginalTransaction.call(this, stores, mode, ...rest);
    };
  });
  for (const enabled of [false, true]) {
    await toggle(page).click();
    await expectCursorPreference(page, enabled);
    await expect(toggle(page)).toBeEnabled();
    await expect(settings(page).getByRole('alert')).toContainText('Could not save');
    assert.equal(await storedCursor(page), true);
    assert.deepEqual(await cache(page), confirmed, 'A failed write must not refresh the confirmed appearance cache.');
    await consumeStorageErrors(this);
  }
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = window.cursorOriginalTransaction;
    delete window.cursorOriginalTransaction;
    window.cursorRetriedWrites = [];
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.transaction.db.name === 'v1/settings' && key === 'customCursors') window.cursorRetriedWrites.push(value);
      return originalPut.call(this, value, key);
    };
  });
  await settings(page).getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(settings(page).getByRole('alert')).toHaveCount(0);
  await expect.poll(() => storedCursor(page)).toBe(true);
  assert.deepEqual(await page.evaluate(() => window.cursorRetriedWrites), [true], 'Retry must actually write the latest choice, even when it matches the older saved value.');
  await page.reload();
  await openSection(page, 'Theme');
  await expectCursorPreference(page, true);
});

Then('a cursor edit made during a delayed settings retry remains authoritative', async function () {
  const page = this.page;
  await storedCursor(page, false);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, theme: 'light', palette: 'default', customCursors: false })), cacheKey);
  await page.addInitScript(() => {
    window.cursorOriginalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...args) {
      if (name === 'v1/settings') throw new DOMException('Cursor review storage unavailable', 'SecurityError');
      return window.cursorOriginalOpen.call(this, name, ...args);
    };
  });
  await page.reload();
  await openSection(page, 'Theme');
  await expectCursorPreference(page, false);
  await consumeStorageErrors(this);
  await page.evaluate(() => {
    IDBFactory.prototype.open = window.cursorOriginalOpen;
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      const request = originalGet.call(this, key);
      if (this.transaction.db.name !== 'v1/settings' || this.transaction.mode !== 'readonly' || key !== 'customCursors') return request;
      IDBObjectStore.prototype.get = originalGet;
      const originalListen = request.addEventListener;
      request.addEventListener = function (type, listener, options) {
        if (type !== 'success') return originalListen.call(this, type, listener, options);
        return originalListen.call(this, type, event => {
          window.releaseCursorSettingsRead = () => listener.call(request, event);
        }, options);
      };
      return request;
    };
  });
  await openSection(page, 'Browser');
  await settings(page).getByRole('button', { name: 'Retry saved settings', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseCursorSettingsRead === 'function');
  await settings(page).locator('summary[aria-label="Theme"]').click();
  await toggle(page).click();
  await expectCursorPreference(page, true);
  await expect.poll(() => storedCursor(page)).toBe(true);
  await expect.poll(async () => (await cache(page)).customCursors).toBe(true);
  // Release the stale read and await the UI retry completion before checking
  // both guards. The newer write must already be committed and cached so its
  // eventual completion cannot hide a stale cache update from the held read.
  await page.evaluate(() => window.releaseCursorSettingsRead());
  await expect(page.getByRole('heading', { name: 'Saved settings are unavailable', exact: true })).toHaveCount(0);
  await settings(page).locator('summary[aria-label="Browser"]').click();
  await expect(settings(page).getByRole('button', { name: /^(Retry saved settings|Retrying saved settings…)/ })).toHaveCount(0);
  await expectCursorPreference(page, true);
  await expect.poll(() => storedCursor(page)).toBe(true);
  await expect.poll(async () => (await cache(page)).customCursors).toBe(true);
});

Then('custom and native port cursors preserve connection eligibility and disabled exceptions', async function () {
  const page = this.page;
  const node = id => workflow(page).locator(`.svelte-flow__node[data-id="single-${id}"]`);
  const source = node('source-b').locator('[data-handleid="result"]');
  const free = node('free-fields').locator('[data-handleid="first"]');
  const locked = node('target').locator('[data-handleid="occupied"]');
  const structural = node('target').locator('.structural-port');
  const before = (await readExport(page)).document.edges;
  for (const enabled of [true, false]) {
    await enableCursors(page, enabled);
    await setMode(page, 'workflow');
    await expect(source).toHaveClass(/\bconnectionindicator\b/);
    await expect(free).toHaveClass(/\bconnectableend\b/);
    await expect(free).not.toHaveClass(/\bconnectionindicator\b/);
    await expect(locked).toHaveAttribute('aria-disabled', 'true');
    await expect(locked).not.toHaveClass(/\bconnectionindicator\b/);
    await expectCursor(source, 'crosshair', enabled);
    await expectCursor(free, 'grab', enabled);
    await expectCursor(locked, 'grab', enabled);
    await expectCursor(structural, 'default', enabled);
    await gesture(page, source, locked, 'drag', async () => {
      await expect(free).toHaveClass(/\bconnectionindicator\b/);
      await expectCursor(free, 'crosshair', enabled);
      await expectCursor(locked, 'grab', enabled);
    });
    await page.keyboard.press('Escape');
    assert.deepEqual((await readExport(page)).document.edges, before, 'Cursor changes must preserve the rejection of an occupied input.');
  }
  await gesture(page, source, free);
  await expect(free).toHaveAttribute('aria-disabled', 'true');
  assert.equal((await readExport(page)).document.edges.length, before.length + 1, 'An eligible port must still accept a mapping.');
});

Then('custom and native segment cursors match their allowed movement axes', async function () {
  const page = this.page;
  const edge = workflow(page).locator('.svelte-flow__edge[data-id="manual-edge"]');
  for (const enabled of [true, false]) {
    await enableCursors(page, enabled);
    await setMode(page, 'workflow');
    await edge.focus();
    await page.keyboard.press('Enter');
    await expect(edge).toHaveClass(/\bselected\b/);
    for (const [axis, role] of [['x', 'ew-resize'], ['y', 'ns-resize']]) {
      const control = edge.locator(`.flow-routing-segment-handle[data-axis="${axis}"]`).first();
      await expect(control).toBeVisible();
      await expectCursor(control, role, enabled);
    }
  }
});

// The hidden Settings workspace stays mounted. Invoke its real switch handler
// without moving the pointer or releasing capture so an in-progress gesture
// can verify the preference update independently from workspace navigation.
async function changeDuringGesture(page) {
  await toggle(page).evaluate(element => element.click());
  await expectCursorPreference(page, false);
}

Then('canvas node and minimap dragging keep their cursor states through an immediate opt-out', async function () {
  const page = this.page;
  const pane = workflow(page).locator('.svelte-flow__pane');
  const viewport = workflow(page).locator('.svelte-flow__viewport');
  const node = workflow(page).locator('.svelte-flow__node[data-id="single-source-b"]');
  const minimap = page.getByRole('group', { name: 'Workflow minimap', exact: true }).locator('svg');
  for (const kind of ['canvas', 'node', 'minimap']) {
    await enableCursors(page, true);
    await setMode(page, 'workflow');
    const target = kind === 'canvas' ? pane : kind === 'node' ? node : minimap;
    const box = await target.boundingBox();
    assert.ok(box);
    const point = kind === 'canvas' ? { x: box.x + 60, y: box.y + box.height - 60 }
      : await center(kind === 'node' ? node.locator('.utility-title') : target);
    const moving = kind === 'node' ? node : viewport;
    const initial = await moving.getAttribute('style');
    await expectCursor(target, 'grab', true);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 30, point.y + 20, { steps: 5 });
    await expectCursor(target, 'grabbing', true);
    await changeDuringGesture(page);
    await expectCursor(target, 'grabbing', false);
    await page.mouse.move(point.x + 60, point.y + 40, { steps: 5 });
    await page.mouse.up();
    await expectCursor(target, 'grab', false);
    await expect(moving).not.toHaveAttribute('style', initial);
  }
});

Then('{string} renders and disables cursor artwork at density {int} and CSS zoom {float}', async function (name, density, zoom) {
  const engine = { Firefox: firefox, WebKit: webkit }[name];
  assert.ok(engine, `Unsupported cursor review engine: ${name}`);
  const browser = await engine.launch();
  try {
    await this.attach(JSON.stringify({ name: browser.browserType().name(), version: browser.version(), density, cssZoom: zoom }),
      'application/vnd.operations.browser+json');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light',
      reducedMotion: 'reduce', deviceScaleFactor: density, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(`${this.baseURL}/`) || url.startsWith('data:') || url.startsWith('blob:')) await route.continue();
      else {
        this.diagnostics.push({ type: 'unexpected-network-request', url, browser: name });
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => this.diagnostics.push({ type: 'pageerror', message: error.message, browser: name }));
    page.on('console', message => {
      if (message.type() === 'error') this.diagnostics.push({ type: 'console-error', message: message.text(), browser: name });
    });
    await page.goto(this.baseURL);
    await page.locator('#startup-status').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.getElementById('app')?.hasChildNodes() && !document.getElementById('app').hasAttribute('inert'));
    await page.locator('html').evaluate((root, zoom) => { root.style.zoom = String(zoom); }, zoom);
    assert.equal(await page.evaluate(() => window.devicePixelRatio), density);
    for (const dark of [false, true]) {
      await enableCursors(page, true);
      await theme(page, dark);
      await expectEmbeddedArtwork(page);
      await expectCursor(toggle(page), 'pointer', true);
      await enableCursors(page, false);
      await expectCursor(toggle(page), 'pointer', false);
      await setMode(page, 'operations');
      await expect(page.locator('.site-header .brand')).toHaveCSS('cursor', 'auto');
      await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveCSS('cursor', /^(auto|text)$/);
    }
  } finally {
    await browser.close();
  }
});
