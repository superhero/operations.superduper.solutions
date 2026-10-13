// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run with matching Playwright Chromium: node tests/settings-startup.smoke.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { pail } from '@visulima/pail';

const artifactDirectory = resolve('tmp/test/settings-startup');
await mkdir(artifactDirectory, { recursive: true });
const server = await createServer({ configFile: resolve('vite.config.mjs'), configLoader: 'native',
  cacheDir: resolve(artifactDirectory, '.vite'),
  server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
const saved = { theme: 'dark', palette: 'sunset',
  workflowDefaults: { dashed: true, curved: true, snap: true, nodeSymbols: true, gridSize: 27, dashLength: 8, dashGap: 4, dashSpeed: 32, curveStrength: 50, nodeClearance: 24 } };
const cases = [];
const diagnostics = [];
const chainMessage = 'Cause-tree regression preview.';
const preservationWarning = 'Protect your saved work. Clearing site data will permanently delete all progress done in this application; nothing is saved on a server, everything is saved locally in your browser.';
let browser;
let page;
let succeeded = false;

async function expectPreservationFooter(overlay) {
  const panel = overlay;
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('id', '__v_o__panel');
  await expect.poll(() => panel.evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { content: style.content, visible: style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity) > 0 };
  })).toEqual({ content: JSON.stringify(preservationWarning), visible: true });
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not settle within 12 seconds.`)), 12_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function holdTransaction(holder) {
  await holder.evaluate(() => {
    globalThis.holdWriter = true;
    const transaction = globalThis.heldDatabase.transaction('settings', 'readwrite');
    globalThis.writerDone = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    const spin = () => {
      const request = transaction.objectStore('settings').get('theme');
      request.onsuccess = () => { if (globalThis.holdWriter) spin(); };
    };
    spin();
  });
}

async function releaseTransaction(holder) {
  await holder.evaluate(async () => { globalThis.holdWriter = false; await globalThis.writerDone; });
}

async function readSaved(holder) {
  return within(holder.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const storeName = database.objectStoreNames.contains('settings') ? 'settings' : 'preferences';
      const transaction = database.transaction(storeName, 'readonly');
      const values = {};
      for (const key of ['theme', 'palette', 'workflowDefaults']) {
        const read = transaction.objectStore(storeName).get(key);
        read.onsuccess = () => { if (read.result !== undefined) values[key] = read.result; };
      }
      transaction.oncomplete = () => { database.close(); resolve(values); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  })), 'Reading stored settings');
}

try {
  await server.listen();
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch();
  for (const stage of ['legacy-upgrade', 'open', 'transaction', 'security']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(`${baseURL}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      diagnostics.push({ stage, type: 'unexpected-network', url });
      return route.abort();
    });
    await context.route(`${baseURL}/__settings-holder`, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Temporary settings blocker</title>' }));
    const holder = await context.newPage();
    await holder.goto(`${baseURL}/__settings-holder`);
    const expected = stage === 'legacy-upgrade' ? { theme: saved.theme, palette: saved.palette } : saved;
    await holder.evaluate(({ stage, expected }) => new Promise((resolve, reject) => {
      const storeName = stage === 'legacy-upgrade' ? 'preferences' : 'settings';
      const request = indexedDB.open('v1/settings', stage === 'legacy-upgrade' ? 1 : 2);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        globalThis.heldDatabase = request.result;
        const transaction = request.result.transaction(storeName, 'readwrite');
        for (const [key, value] of Object.entries(expected)) transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      };
    }), { stage, expected });
    if (stage === 'transaction') await holdTransaction(holder);
    page = await context.newPage();
    const storageErrors = [];
    page.on('pageerror', error => {
      diagnostics.push({ stage, type: 'pageerror', message: error.message });
    });
    page.on('console', message => {
      if (message.type() !== 'error' || message.text().includes(chainMessage)) return;
      storageErrors.push(message.args()[0].evaluate(error => ({ native: error instanceof Error,
        name: error?.name, message: error?.message, stack: error?.stack, stage: error?.stage,
        cause: { native: error?.cause instanceof Error || error?.cause instanceof DOMException,
          name: error?.cause?.name, message: error?.cause?.message, code: error?.cause?.code,
          original: globalThis.settingsSecurityErrors?.includes(error?.cause) ?? null } })).catch(error => ({ readError: error.message })));
    });
    await page.addInitScript(stage => {
      localStorage.setItem('operations-theme', 'light');
      localStorage.setItem('operations-palette', 'default');
      globalThis.settingsWrites = [];
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.transaction.db.name === 'v1/settings') globalThis.settingsWrites.push({ key, value });
        return put.apply(this, arguments);
      };
      if (!['open', 'security'].includes(stage)) return;
      const open = IDBFactory.prototype.open;
      const requests = [];
      let stalled = true;
      globalThis.settingsSecurityErrors = [];
      IDBFactory.prototype.open = function (name) {
        if (name === 'v1/settings' && stalled && stage === 'security') {
          const error = new DOMException('Test browser policy blocked saved settings storage.', 'SecurityError');
          globalThis.settingsSecurityErrors.push(error);
          throw error;
        }
        const request = open.apply(this, arguments);
        if (name === 'v1/settings' && stalled) {
          requests.push(request);
          request.addEventListener('success', event => { if (stalled) event.stopImmediatePropagation(); }, true);
        }
        return request;
      };
      globalThis.releaseSettingsOpen = () => {
        stalled = false;
        for (const request of requests) if (request.readyState === 'done') request.dispatchEvent(new Event('success'));
      };
    }, stage);
    const started = Date.now();
    await page.goto(baseURL,
      { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#startup-status')).toHaveCount(0);
    const elapsedMs = Date.now() - started;
    const retry = page.getByRole('button', { name: 'Retry saved settings', exact: true });
    const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
    const storage = settings.locator('details').filter({ has: page.locator('summary[aria-label="Browser"]') });
    const overlay = page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true });
    const expectStorageError = async count => {
      await expect(overlay).toBeVisible();
      await expectPreservationFooter(overlay);
      await expect.poll(() => storageErrors.length).toBe(count);
      const reported = await storageErrors[count - 1];
      assert.equal(reported.native, true, 'Pail must send the native storage Error as its first console argument.');
      assert.equal(reported.name, 'SettingsStorageError');
      assert.equal(reported.stage, stage === 'transaction' ? 'read' : 'open');
      assert.equal(reported.cause.native, true, 'The storage error must preserve its standard native cause.');
      assert.equal(reported.cause.name, stage === 'security' ? 'SecurityError' : 'TimeoutError');
      assert.equal(reported.cause.code, stage === 'security' ? 18 : 23);
      if (stage === 'security') assert.equal(reported.cause.original, true, 'The original rejected DOMException must remain error.cause.');
      assert.match(reported.stack, /\/lib\/(?:settings-storage-error|app-settings)\.ts:/);
      await writeFile(`${artifactDirectory}/${stage}-error-${count}.json`, `${JSON.stringify(reported, null, 2)}\n`);
      await expect(overlay.locator('#__v_o__message')).toContainText(reported.message);
      await expect(overlay.locator('.shiki').first()).toBeVisible();
      // The nested tree and native arrows select related details of one failure.
      // Only a real failed retry adds another report to the error history.
      const context = overlay.locator('#operations-error-context');
      const explanation = context.getByRole('button', { name: reported.name, exact: true });
      const cause = context.getByRole('button', { name: `${reported.cause.name} · ${reported.cause.code}`, exact: true });
      const previous = overlay.getByRole('button', { name: 'Previous related detail', exact: true });
      const next = overlay.getByRole('button', { name: 'Next related detail', exact: true });
      await expect(overlay.locator('#__v_o__pagination_current')).toHaveText('1');
      await expect(overlay.locator('#__v_o__pagination_total')).toHaveText('2');
      await expect(context).toHaveAttribute('aria-label', 'Error cause chain');
      await expect(context.locator('ol ol')).toHaveCount(1);
      await expect(context.getByRole('button')).toHaveCount(2);
      await expect(context.locator('strong, p')).toHaveCount(0);
      await expect(explanation).toHaveAttribute('aria-current', 'true');
      await expect(cause).not.toHaveAttribute('aria-current', 'true');
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await expect.poll(() => page.evaluate(() => globalThis.__v_o__current.__v_oHistory.length)).toBe(count);
      if (stage === 'open' && count === 1) {
        await page.evaluate(async () => {
          const { initErrorOverlayContext } = await import('/dev/error-overlay-context.ts');
          const disposeOlder = initErrorOverlayContext();
          globalThis.disposeOverlayContext = initErrorOverlayContext();
          disposeOlder();
        });
        await expect(context).toHaveCount(1);
        await expect(explanation).toHaveAttribute('aria-current', 'true');
        await page.evaluate(() => globalThis.disposeOverlayContext());
        await expect(context).toHaveCount(0);
        assert.equal(await overlay.locator('#__v_o__error-overlay-pagination-next').getAttribute('aria-label'), null);
        await page.evaluate(async () => { (await import('/dev/error-overlay-context.ts')).initErrorOverlayContext(); });
        await expect(context).toHaveCount(1);
      }
      await cause.click();
      await expect(overlay.locator('#__v_o__pagination_current')).toHaveText('2');
      await expect(cause).toHaveAttribute('aria-current', 'true');
      await expect(explanation).not.toHaveAttribute('aria-current', 'true');
      await expect(overlay.locator('#__v_o__heading')).toHaveText(reported.cause.name);
      await expect(overlay.locator('#__v_o__message')).toContainText(reported.cause.message);
      await expectPreservationFooter(overlay);
      await expect(previous).toBeEnabled();
      await expect(next).toBeDisabled();
      await expect.poll(() => page.evaluate(() => globalThis.__v_o__current.__v_oHistory.length)).toBe(count);
      if (count === 1) await page.screenshot({ path: `${artifactDirectory}/${stage}-underlying-cause.png` });
      await explanation.click();
      await expect(explanation).toHaveAttribute('aria-current', 'true');
      await next.click();
      await expect(cause).toHaveAttribute('aria-current', 'true');
      await previous.click();
      await expect(explanation).toHaveAttribute('aria-current', 'true');
      await expect(overlay.locator('#__v_o__heading')).toHaveText(reported.name);
      await expect(overlay.locator('#__v_o__message')).toContainText(reported.message);
      await expect(overlay.locator('.shiki').first()).toBeVisible();
      await expectPreservationFooter(overlay);
      assert.ok(reported.message.includes(baseURL), 'Recovery guidance must name the current origin.');
      assert.ok(!reported.message.includes(preservationWarning), 'The permanent warning must live in the footer, not the raw error message.');
      if (stage === 'security') assert.match(reported.message, /permissions|privacy|browser settings|browser policy/i);
      else {
        if (stage === 'open') {
          assert.match(reported.message, /possible causes/i);
          assert.match(reported.message, /browser[^.]*profile|profile[^.]*browser/i);
        } else assert.match(reported.message, /database opened[^]*pending write transaction/i);
        assert.match(reported.message, /fully (?:quit|close)|quit[^.]*browser/i);
      }
      return reported;
    };
    if (stage === 'legacy-upgrade') {
      await expect(retry).toHaveCount(0);
      await expect(overlay).toHaveCount(0);
      await expect(page.locator(':root')).toHaveAttribute('data-theme', saved.theme);
      await expect(page.locator(':root')).toHaveAttribute('data-palette', saved.palette);
      assert.deepEqual(await holder.evaluate(() => ({ version: globalThis.heldDatabase.version,
        stores: [...globalThis.heldDatabase.objectStoreNames] })), { version: 1, stores: ['preferences'] });
    } else {
      await expect(retry).toHaveCount(0);
      await expectStorageError(1);
      await page.screenshot({ path: `${artifactDirectory}/${stage}-storage-error.png` });
      await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => globalThis.settingsWrites), [], `${stage}: fallback must not write settings.`);
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('group', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
      await settings.locator('summary[aria-label="Browser"]').click();
      await expect(storage.getByRole('button', { name: 'Retry saved settings', exact: true })).toBeVisible();
      await expect(retry).toHaveCount(1);
      await page.evaluate(() => { globalThis.settingsRecoveryMarker = 'same-document'; });
      await retry.click();
      if (stage !== 'security')
        await expect(storage.getByRole('button', { name: 'Retrying saved settings…', exact: true })).toBeDisabled();
      await expectStorageError(2);
      await page.screenshot({ path: `${artifactDirectory}/${stage}-retry-error.png` });
      await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
      await expect(retry).toBeEnabled();
      await expect(page.getByRole('alert').filter({ hasText: (await storageErrors[1]).message })).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => globalThis.settingsWrites), [], `${stage}: fallback must not write settings.`);
      assert.deepEqual(await page.evaluate(() => [localStorage.getItem('operations-theme'), localStorage.getItem('operations-palette')]),
        ['light', 'default'], `${stage}: incomplete settings loads must retain legacy preferences.`);
    }
    await page.screenshot({ path: `${artifactDirectory}/${stage}-mounted.png` });
    if (stage === 'legacy-upgrade') await holder.evaluate(() => globalThis.heldDatabase.close());
    if (['open', 'security'].includes(stage)) await page.evaluate(() => globalThis.releaseSettingsOpen());
    if (stage === 'transaction') await releaseTransaction(holder);
    if (stage !== 'legacy-upgrade') {
      assert.deepEqual(await readSaved(holder), expected, `${stage}: late completion must preserve every saved setting.`);
      assert.deepEqual(await page.evaluate(() => globalThis.settingsWrites), [], `${stage}: timed-out work must not resume writing.`);
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(settings).toBeVisible();
      assert.equal(await page.evaluate(() => globalThis.settingsRecoveryMarker), 'same-document', 'Retry must preserve the current page.');
      await expect(page.locator(':root')).toHaveAttribute('data-theme', saved.theme);
      await expect(page.locator(':root')).toHaveAttribute('data-palette', saved.palette);
      await expect(page.getByRole('alert').filter({ hasText: (await storageErrors[1]).message })).toHaveCount(0);
      await expect(overlay).toBeHidden();
      assert.equal(storageErrors.length, 2, 'Successful recovery must not create another error.');
      await page.screenshot({ path: `${artifactDirectory}/${stage}-recovered.png` });
    }
    const recovered = await within(page.evaluate(async () =>
      (await import('/lib/app-settings.ts')).loadSettings(['default', 'sunset', 'alpine'])), 'Retrying settings load');
    assert.equal(recovered.theme, saved.theme);
    assert.equal(recovered.palette, saved.palette);
    assert.equal(recovered.storageError, null);
    if (stage !== 'legacy-upgrade') assert.deepEqual(recovered.workflowDefaults, saved.workflowDefaults);
    if (stage === 'transaction') {
      await holdTransaction(holder);
      const failedSave = await within(page.evaluate(async () => {
        try { await (await import('/lib/app-settings.ts')).saveSetting('palette', 'alpine'); return null; }
        catch (error) { return error.message; }
      }), 'Timing out a stalled settings save');
      assert.equal(typeof failedSave, 'string', 'A stalled write must reject instead of remaining queued forever.');
      await releaseTransaction(holder);
      assert.deepEqual(await readSaved(holder), expected, 'A timed-out write must never commit after its blocker is released.');
    }
    await within(page.evaluate(async () => (await import('/lib/app-settings.ts')).saveSetting('palette', 'alpine')), 'Retrying settings save');
    assert.equal((await readSaved(holder)).palette, 'alpine', `${stage}: saving must recover after the stalled operation.`);
    const reportedErrors = await Promise.all(storageErrors);
    assert.equal(reportedErrors.length, stage === 'legacy-upgrade' ? 0 : 2,
      'Only the original failed load and failed retry should report real storage errors.');
    if (stage === 'legacy-upgrade') {
      await page.evaluate(async message => {
        const leaf = new TypeError('Leaf cause without a code.');
        const middle = Object.assign(new Error('Nested cause with a zero code.', { cause: leaf }),
          { name: 'NestedPreviewError', code: 0 });
        const failure = Object.assign(new Error(message, { cause: middle }),
          { name: 'ChainPreviewError', code: 'E_PREVIEW' });
        (await import('/lib/logger.ts')).logger.error(failure);
      }, chainMessage);
      await expect(overlay).toBeVisible();
      const tree = overlay.locator('#operations-error-context');
      await expect(tree.getByRole('button')).toHaveText(['ChainPreviewError · E_PREVIEW', 'NestedPreviewError · 0', 'TypeError']);
      await expect(tree.locator('ol ol')).toHaveCount(2);
      await expect(overlay.locator('#__v_o__pagination_total')).toHaveText('3');
      await expect(tree.locator('[aria-current="true"]')).toHaveCount(1);
      await tree.getByRole('button', { name: 'TypeError', exact: true }).click();
      await expect(overlay.locator('#__v_o__pagination_current')).toHaveText('3');
      await expect(tree.getByRole('button', { name: 'TypeError', exact: true })).toHaveAttribute('aria-current', 'true');
      await expect(overlay.locator('#__v_o__heading')).toHaveText('TypeError');
      await expectPreservationFooter(overlay);
      await overlay.getByRole('button', { name: 'Previous related detail', exact: true }).click();
      await expect(tree.getByRole('button', { name: 'NestedPreviewError · 0', exact: true })).toHaveAttribute('aria-current', 'true');
      await tree.getByRole('button', { name: 'ChainPreviewError · E_PREVIEW', exact: true }).click();
      await expect(overlay.locator('#__v_o__pagination_current')).toHaveText('1');
      await expect(tree.getByRole('button', { name: 'ChainPreviewError · E_PREVIEW', exact: true })).toHaveAttribute('aria-current', 'true');
      assert.equal(await page.evaluate(() => globalThis.__v_o__current.__v_oHistory.length), 1,
        'Three related details must remain one reported failure.');
      await page.screenshot({ path: `${artifactDirectory}/nested-cause-tree.png` });
      await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
    }
    cases.push({ stage, elapsedMs, recovered: true, reportedErrors });
    await context.close();
  }
  assert.deepEqual(diagnostics, [], 'Storage fallback and recovery must not produce unexpected browser errors.');
  succeeded = true;
  pail.force.success('Settings startup smoke passed: native storage errors, actionable overlays, failed retries, no late writes, and recovery.');
} finally {
  if (!succeeded && page && !page.isClosed()) await page.screenshot({ path: `${artifactDirectory}/failure.png` }).catch(() => {});
  await writeFile(`${artifactDirectory}/result.json`, `${JSON.stringify({ succeeded, cases, diagnostics }, null, 2)}\n`);
  await browser?.close();
  await server.close();
}
