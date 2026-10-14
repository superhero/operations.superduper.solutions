// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run: node tests/appearance-cache.smoke.mjs (isolated server and browser contexts).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const directory = resolve('tmp/test/appearance-cache');
const cacheKey = 'v1/settings/appearance-cache';
const cached = { version: 1, theme: 'dark', palette: 'sunset' };
const authoritative = { theme: 'light', palette: 'alpine',
  workflowDefaults: { dashed: true, curved: false, snap: true, nodeSymbols: true, gridSize: 27, dashLength: 8, dashGap: 6, dashSpeed: 32, curveStrength: 70, nodeClearance: 24 } };
const defaults = { theme: 'light', palette: 'default',
  workflowDefaults: { dashed: true, curved: false, snap: true, nodeSymbols: true, gridSize: 8, dashLength: 8, dashGap: 16, dashSpeed: 64, curveStrength: 100, nodeClearance: 16 } };
const results = [], errors = [];
await mkdir(directory, { recursive: true });
const server = await createServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
  cacheDir: resolve(directory, '.vite'), server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
let browser;

async function appearance(page, expected) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', expected.theme);
  await expect(page.locator('html')).toHaveAttribute('data-palette', expected.palette);
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), expected.theme === 'dark');
}

async function loadingColors(page, expected) {
  await appearance(page, expected);
  await expect(page.locator('#startup-status')).toBeVisible();
  await expect.poll(() => page.evaluate(({ theme, palette }) => {
    const preview = document.createElement('div');
    preview.dataset.palettePreview = palette;
    preview.style.background = `var(--palette-${theme === 'dark' ? 6 : 1})`;
    document.body.appendChild(preview);
    const target = getComputedStyle(preview).backgroundColor;
    const actual = getComputedStyle(document.querySelector('#startup-status')).backgroundColor;
    const cssLoaded = getComputedStyle(preview).getPropertyValue('--palette-1').trim() !== '';
    preview.remove();
    return cssLoaded && target !== 'rgba(0, 0, 0, 0)' && actual === target;
  }, expected), { message: 'The loading screen must paint the cached palette before application JavaScript runs' }).toBe(true);
}

async function settingsValues(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('settings', 'readonly'), values = {};
      for (const key of ['theme', 'palette', 'workflowDefaults']) {
        const read = transaction.objectStore('settings').get(key);
        read.onsuccess = () => { values[key] = read.result; };
      }
      transaction.oncomplete = () => { database.close(); resolve(values); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true });
  for (const scenario of ['stale-cache', 'empty-settings', 'corrupt-json', 'invalid-cache', 'unavailable-storage', 'settings-failure']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => route.request().url().startsWith(`${base}/`) || /^(data|blob):/.test(route.request().url())
      ? route.continue() : route.abort());
    await context.route(`${base}/__appearance-holder`, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Isolated appearance settings</title>' }));
    const holder = await context.newPage();
    await holder.goto(`${base}/__appearance-holder`);
    const raw = scenario === 'corrupt-json' ? '{broken' : scenario === 'invalid-cache'
      ? JSON.stringify({ version: 2, theme: 'dark', palette: 'sunset' }) : JSON.stringify(cached);
    await holder.evaluate(({ cacheKey, raw, settings }) => new Promise((resolve, reject) => {
      localStorage.setItem(cacheKey, raw);
      const request = indexedDB.open('v1/settings');
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction('settings', 'readwrite');
        for (const [key, value] of Object.entries(settings)) transaction.objectStore('settings').put(value, key);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    }), { cacheKey, raw, settings: scenario === 'empty-settings' ? {} : authoritative });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push({ scenario, message: error.message }));
    await page.addInitScript(({ scenario, cacheKey }) => {
      const state = window.appearanceProbe = { settingsOpens: 0, writes: [], held: [], blocked: scenario === 'stale-cache' };
      if (scenario === 'unavailable-storage') {
        // Isolate this feature's denied storage access from the development
        // toolbar's unrelated localStorage usage and error overlay listeners.
        const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
          if (key === cacheKey) throw new DOMException('Isolated appearance cache denial', 'SecurityError');
          return getItem.apply(this, arguments);
        };
        Storage.prototype.setItem = function(key) {
          if (key === cacheKey) throw new DOMException('Isolated appearance cache quota', 'QuotaExceededError');
          return setItem.apply(this, arguments);
        };
      }
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function(name) {
        if (name === 'v1/settings') {
          state.settingsOpens++;
          if (scenario === 'settings-failure') throw new DOMException('Isolated settings read denial', 'SecurityError');
        }
        const request = open.apply(this, arguments);
        if (name === 'v1/settings' && state.blocked) request.addEventListener('success', event => {
          if (state.blocked) { event.stopImmediatePropagation(); state.held.push(request); }
        }, true);
        return request;
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.transaction.db.name === 'v1/settings') state.writes.push({ key, value });
        return put.apply(this, arguments);
      };
      state.release = () => {
        state.blocked = false;
        for (const request of state.held) request.dispatchEvent(new Event('success'));
        state.held.length = 0;
      };
    }, { scenario, cacheKey });
    let releaseEntry;
    let entryGate = new Promise(resolve => { releaseEntry = resolve; });
    await page.route(/\/index\.ts(?:\?|$)/, async route => { await entryGate; await route.continue(); });
    try {
      await page.goto(base, { waitUntil: 'commit', timeout: 60000 });
      const early = ['stale-cache', 'empty-settings', 'settings-failure'].includes(scenario) ? cached : defaults;
      await loadingColors(page, early);
      assert.equal(await page.locator('#app').evaluate(element => element.childElementCount), 0,
        'The cache must apply before App mounts');
      assert.equal(await page.evaluate(() => window.appearanceProbe.settingsOpens), 0,
        'The early cache and stylesheet must not need an IndexedDB request');
      await page.screenshot({ path: resolve(directory, `${scenario}-early.png`) });
      releaseEntry();
      if (scenario === 'stale-cache') {
        await expect.poll(() => page.evaluate(() => window.appearanceProbe.held.length)).toBeGreaterThan(0);
        await loadingColors(page, cached);
        await page.evaluate(() => window.appearanceProbe.release());
      }
      await expect(page.locator('#startup-status')).toHaveCount(0, { timeout: 30000 });
      if (scenario === 'settings-failure') {
        await appearance(page, cached);
        await expect(page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true })).toBeVisible();
        assert.deepEqual(await page.evaluate(() => window.appearanceProbe.writes), [],
          'A cached fallback must never be written into IndexedDB');
        assert.deepEqual(await settingsValues(holder), authoritative);
        assert.equal(await holder.evaluate(key => localStorage.getItem(key), cacheKey), raw);
      } else {
        const expected = scenario === 'empty-settings' ? defaults : authoritative;
        await appearance(page, expected);
        if (scenario !== 'unavailable-storage') await expect.poll(() => holder.evaluate(key => JSON.parse(localStorage.getItem(key)), cacheKey))
          .toEqual({ version: 1, theme: expected.theme, palette: expected.palette });
        await expect.poll(() => settingsValues(holder)).toEqual(expected);
      }
      if (scenario === 'unavailable-storage') {
        const deniedGetter = await page.evaluate(async () => {
          const { readAppearanceCache, writeAppearanceCache } = await import('/lib/appearance-cache.ts');
          const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
          Object.defineProperty(window, 'localStorage', { configurable: true,
            get() { throw new DOMException('Isolated localStorage getter denial', 'SecurityError'); } });
          // Restore synchronously so unrelated development tools never observe
          // this getter. Both cache helpers must absorb native storage denial.
          try {
            const read = readAppearanceCache(['default', 'sunset', 'alpine']);
            writeAppearanceCache({ theme: 'dark', palette: 'sunset' });
            return read;
          } finally { Object.defineProperty(window, 'localStorage', descriptor); }
        });
        assert.equal(deniedGetter, null);
      }
      if (scenario === 'stale-cache') {
        const failure = await page.evaluate(async () => {
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function(value, key) {
            if (this.transaction.db.name === 'v1/settings' && key === 'theme')
              throw new DOMException('Isolated appearance save failure', 'QuotaExceededError');
            return put.apply(this, arguments);
          };
          try {
            await (await import('/lib/app-settings.ts')).saveSetting('theme', 'dark');
            return null;
          } catch (error) { return error.cause?.name; }
          finally { IDBObjectStore.prototype.put = put; }
        });
        assert.equal(failure, 'QuotaExceededError');
        assert.deepEqual(await holder.evaluate(key => JSON.parse(localStorage.getItem(key)), cacheKey),
          { version: 1, theme: authoritative.theme, palette: authoritative.palette },
          'A rejected IndexedDB write must not update the appearance cache');
        assert.deepEqual(await settingsValues(holder), authoritative);
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await page.getByRole('switch', { name: 'Dark theme', exact: true }).click();
        await expect.poll(() => holder.evaluate(key => JSON.parse(localStorage.getItem(key)), cacheKey))
          .toEqual({ version: 1, theme: 'dark', palette: 'alpine' });
        await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
        await page.locator('summary[aria-label="Theme"]').click();
        await page.getByRole('radio', { name: 'Sunset', exact: true }).check();
        await expect.poll(() => holder.evaluate(key => JSON.parse(localStorage.getItem(key)), cacheKey)).toEqual(cached);
        assert.deepEqual(await settingsValues(holder), { ...authoritative, theme: 'dark', palette: 'sunset' });
        entryGate = new Promise(resolve => { releaseEntry = resolve; });
        await page.reload({ waitUntil: 'commit' });
        await loadingColors(page, cached);
        assert.equal(await page.evaluate(() => window.appearanceProbe.settingsOpens), 0);
        releaseEntry();
        await expect.poll(() => page.evaluate(() => window.appearanceProbe.held.length)).toBeGreaterThan(0);
        await page.evaluate(() => window.appearanceProbe.release());
        await expect(page.locator('#startup-status')).toHaveCount(0, { timeout: 30000 });
        await appearance(page, cached);
      }
      results.push({ scenario, passed: true });
    } finally {
      releaseEntry();
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: cached appearance paints before application code and IndexedDB; authoritative or empty settings replace stale cache; saved changes refresh cache across reload; rejected writes preserve cache; corrupt/blocked cache is nonfatal; failed IndexedDB retains cache without writing it back.');
} finally {
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser?.close(); await server.close();
}
