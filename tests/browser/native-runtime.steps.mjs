// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode } from './workspace.fixture.mjs';

const settings = page => page.getByRole('region', { name: 'Secrets vault', exact: true });
const pane = page => page.getByRole('region', { name: 'Native runtimes', exact: true });
const observations = async world => (await world.context.request.get(`${world.baseURL}/native-companion-fixture/${world.nativeId}/observations`)).json();
Before({ tags: '@native-runtime-ui' }, async function ({ pickle }) {
  this.nativeReal = pickle.tags.some(tag => tag.name === '@native-real-runtime');
  // Interception bypasses native CORS preflight. These cases use only the
  // application and an owned loopback TLS endpoint; unexpected access still fails.
  await this.context.unrouteAll({ behavior: 'wait' });
  this.context.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      this.diagnostics.push({ type: 'unexpected-network-request', url: request.url(), method: request.method() });
  });
});
After({ tags: '@native-runtime-ui' }, async function () {
  if (this.nativeId) await this.context.request.delete(`${this.baseURL}/native-companion-fixture/${this.nativeId}/close`);
});
async function prepare(world, wrongOrigin = false) {
  world.nativeId = randomUUID();
  const response = await world.context.request.post(`${world.baseURL}/native-companion-fixture/${world.nativeId}/create`, { data: { real: world.nativeReal, wrongOrigin } });
  assert.equal(response.status(), 200); world.native = await response.json();
  const page = world.page;
  await settings(page).getByLabel('Credential label', { exact: true }).fill('Native pairing key');
  await settings(page).getByLabel('Credential value', { exact: true }).fill(world.native.pairingKey);
  await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(settings(page).locator('li').filter({ hasText: 'Native pairing key' })).toHaveCount(1);
  await page.evaluate(() => {
    globalThis.nativePairMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (typeof message?.method === 'string' && /NativeRuntime$/.test(message.method)) globalThis.nativePairMessages.push(structuredClone(message));
      return original.call(this, message, ...args);
    };
  });
}
async function pair(world) {
  const page = world.page;
  await pane(page).getByLabel('Companion URL', { exact: true }).fill(world.native.host);
  await pane(page).getByRole('combobox', { name: 'Pairing key', exact: true }).click();
  await page.getByRole('option', { name: 'Native pairing key', exact: true }).click();
  await pane(page).getByRole('button', { name: 'Pair runtime', exact: true }).click();
}
async function connected(world) {
  const article = pane(world.page).getByRole('article', { name: 'Runtime Codex', exact: true });
  await expect(article.getByText('Connected', { exact: true })).toBeVisible();
  await expect(article).toContainText('No account connected');
  const result = await observations(world);
  assert.deepEqual(result.methods.slice(0, 3), ['initialize', 'initialized', 'account/read']);
  assert.ok(result.requests.some(request => request.method === 'OPTIONS' && /authorization/i.test(request.requestedHeaders)));
  assert.ok(result.requests.some(request => request.method === 'POST' && request.authorization && request.origin === world.baseURL && !request.cookie));
  assert.ok(result.sockets.every(socket => socket.origin === world.baseURL && socket.protocol === undefined && !socket.path.includes('?')));
  assert.ok(!JSON.stringify(result).includes(world.native.pairingKey));
  assert.ok(!(await world.page.locator('body').innerText()).includes(world.native.pairingKey));
  const messages = await world.page.evaluate(() => globalThis.nativePairMessages ?? []);
  assert.ok(messages.some(message => message.method === 'pairNativeRuntime'));
  assert.ok(!JSON.stringify(messages).includes(world.native.pairingKey));
  return article;
}
function expectedRejection(world) {
  world.diagnostics = world.diagnostics.filter(item => !(item.type === 'console-error'
    && (/CORS|certificate|Failed to fetch|Failed to load resource|net::ERR_/.test(item.message))
    && (!item.location?.url || item.location.url.startsWith(world.native.host) || /CORS|certificate/.test(item.message))));
}

Then('native runtime settings pair reconnect and disconnect through the production worker', { timeout: 60_000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  const stored = await this.page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());
  assert.ok(!JSON.stringify(stored).includes(this.native.pairingKey));
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(this.page, 'settings');
  const disclosure = this.page.locator('summary[aria-label="Secrets"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await settings(this.page).getByLabel('Unlock password, or recovery key', { exact: true }).fill('browser-VAULT-password-9182');
  await settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect.poll(async () => (await observations(this)).stops).toBe(1);
  await pane(this.page).getByRole('button', { name: 'Reconnect runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Connected', { exact: true })).toBeVisible();
  await pane(this.page).getByRole('button', { name: 'Disconnect runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect.poll(async () => (await observations(this)).stops).toBe(2);
  await pane(this.page).getByRole('button', { name: 'Remove pairing', exact: true }).click();
  await expect(pane(this.page).getByRole('article')).toHaveCount(0);
  const result = await observations(this);
  assert.equal(result.real, this.nativeReal); assert.equal(result.starts, result.stops);
  assert.ok(result.methods.every(method => ['initialize', 'initialized', 'account/read'].includes(method)));
});

Then('native runtime settings reject changed authority until the pairing is explicitly replaced', { timeout: 60_000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/change-account`);
  await pane(this.page).getByRole('button', { name: 'Check runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await pane(this.page).getByRole('button', { name: 'Reconnect runtime', exact: true }).click();
  await expect(settings(this.page).getByRole('alert')).toBeVisible();
  assert.equal((await observations(this)).starts, 1, 'Changed pins never spawn a replacement child implicitly.');
  await pane(this.page).getByRole('button', { name: 'Remove pairing', exact: true }).click();
  await expect(pane(this.page).getByRole('article')).toHaveCount(0);
  await pair(this); await connected(this);
  // A second tab can change catalog metadata before this tab receives its
  // library snapshot. Exercise the production worker's independent policy read.
  await this.page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction('catalog', 'readwrite'), store = transaction.objectStore('catalog');
      const reading = store.get('codex');
      reading.onsuccess = () => { if (!reading.result) { transaction.abort(); return; } store.put({ ...reading.result, enabled: false }, 'codex'); };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  await pane(this.page).getByRole('button', { name: 'Check runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect.poll(async () => (await observations(this)).stops).toBe(2);
});

Then('native runtime settings reject an untrusted companion certificate', async function () {
  await prepare(this); await pair(this);
  await expect(settings(this.page).getByRole('alert')).toBeVisible();
  assert.equal((await observations(this)).starts, 0);
  assert.ok(!(await observations(this)).requests.some(request => request.method === 'POST'));
  expectedRejection(this);
});

Then('native runtime settings enforce real companion CORS before sending its pairing key', async function () {
  await prepare(this, true); await pair(this);
  await expect(settings(this.page).getByRole('alert')).toBeVisible();
  const result = await observations(this);
  assert.equal(result.starts, 0); assert.ok(result.requests.some(request => request.method === 'OPTIONS'));
  assert.ok(!result.requests.some(request => request.authorization)); expectedRejection(this);
});
