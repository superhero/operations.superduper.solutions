// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { chooseCatalogOperation, setMode } from './workspace.steps.mjs';

const fixture = '/vault-storage-fixture.js';
const canaries = ['browser-VAULT-password-9182', 'browser-BEARER-canary-9182', 'browser-APIKEY-canary-9182', 'browser-PRIVATE-label-9182'];
const invoke = (page, method, ...args) => page.evaluate(async ({ fixture, method, args }) => (await import(fixture))[method](...args), { fixture, method, args });
const storage = (page, action, ...args) => page.evaluate(async ({ fixture, action, args }) => (await import(fixture)).createVaultStorage()[action](...args), { fixture, action, args });
const observations = async world => (await world.context.request.get(`${world.baseURL}/vault-api/${world.vaultRun}/observations`)).json();
function noCanaries(value) {
  for (const canary of canaries) assert.ok(!JSON.stringify(value).includes(canary), 'A registered private field crossed the inspected boundary');
}
async function seed(world, action) {
  world.vaultRun = randomUUID(); world.vaultAction = action;
  await world.page.goto(`${world.baseURL}/vault-fixture.html`);
  world.vault = await invoke(world.page, 'seed', world.baseURL, world.vaultRun, action);
}
function expectedFetchDiagnostics(world) {
  // The intentional rejected redirect/aborted stream can emit a browser network
  // console error. Preserve all application exceptions and other diagnostics.
  const endpoint = `${world.baseURL}/vault-api/${world.vaultRun}/redirect`;
  world.diagnostics = world.diagnostics.filter(item => !(item.type === 'console-error'
    && /^Failed to load resource(?::|$)/.test(item.message)
    && (!item.location?.url || item.location.url.startsWith(`${world.baseURL}/vault-api/${world.vaultRun}/`)))
    && !(world.browser.browserType().name() === 'webkit' && world.vaultAction === 'redirect'
      && (item.type === 'console-error' && item.message === `Not allowed to follow a redirection while loading ${endpoint}`
        || item.type === 'pageerror' && item.stack === '' && item.message === `${endpoint.slice('http:/'.length)} due to access control checks.`)));
}

Given('an isolated browser vault with synthetic credentials', async function () { await seed(this, 'ok'); });
Given('an isolated browser vault targeting the {string} endpoint', async function (action) { await seed(this, action); });
Given('a vault whose approved request needs cross-origin credentials without CORS permission', async function () {
  this.vaultRun = randomUUID();
  this.vaultCrossOrigin = this.baseURL.replace('127.0.0.1', 'localhost');
  // Request interception bypasses native preflight in Chromium. This isolated
  // fixture has no external resources; the container still has no network.
  await this.context.unrouteAll({ behavior: 'wait' });
  await this.page.goto(`${this.baseURL}/vault-fixture.html`);
  this.vault = await invoke(this.page, 'seed', this.vaultCrossOrigin, this.vaultRun, 'ok');
});

Then('its database and backup contain no registered secret or private label', async function () {
  const stored = await storage(this.page, 'read');
  assert.equal(stored.snapshot.version, 1);
  assert.equal(stored.snapshot.records.length, 2);
  assert.equal(stored.snapshot.envelopes.length, 2);
  assert.ok(stored.snapshot.records.every(record => record.ciphertext.data.length > 40));
  noCanaries(stored); noCanaries(this.vault.backup);
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', [...canaries, this.vault.recovery]), []);
  const locked = await invoke(this.page, 'lockedRun');
  assert.equal(locked.error, 'LOCKED');
  await this.page.reload();
  assert.deepEqual(await storage(this.page, 'read'), stored);
  assert.deepEqual(await observations(this), []);
});

Then('two vault writers racing the same revision produce exactly one conflict', async function () {
  const other = await this.context.newPage();
  await other.goto(`${this.baseURL}/vault-fixture.html`);
  try {
    const before = await storage(this.page, 'read');
    const results = await Promise.all([this.page, other].map(page => page.evaluate(async ({ fixture, before }) => {
      try { return { result: await (await import(fixture)).createVaultStorage().replace(before, before.snapshot) }; }
      catch (error) { return { error: error.code }; }
    }, { fixture, before })));
    assert.equal(results.filter(result => result.error === 'CONFLICT').length, 1);
    assert.equal(results.filter(result => result.result?.revision === before.revision + 1).length, 1);
    const after = await storage(this.page, 'read');
    assert.equal(after.revision, before.revision + 1); assert.equal(after.lockEpoch, before.lockEpoch + 1);
    assert.deepEqual(after.snapshot, before.snapshot);
  } finally { await other.close(); }
});

Then('a vault storage {string} failure is safe and leaves ciphertext unchanged', async function (mode) {
  const { result, unchanged } = await invoke(this.page, 'storageFailure', mode);
  assert.equal(result.error, 'UNAVAILABLE');
  assert.equal(result.cause, false);
  assert.ok(!result.message.includes('PRIVATE'));
  assert.equal(unchanged, true);
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', canaries), []);
});

Then('a blocked native database open fails within its deadline without recreating deleted storage', async function () {
  const result = await invoke(this.page, 'blockedOpen');
  assert.equal(result.result.error, 'UNAVAILABLE'); assert.equal(result.result.cause, false);
  assert.equal(result.unchanged, true); assert.equal(result.recreated, false);
  assert.ok(result.elapsed >= 2000 && result.elapsed < 10_000, 'blocked open must have a bounded failure');
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', canaries), []);
});

Then('another tab durably locks the vault and stale execution never reaches the endpoint', async function () {
  const other = await this.context.newPage();
  await other.goto(`${this.baseURL}/vault-fixture.html`);
  try { await storage(other, 'lock'); }
  finally { await other.close(); }
  assert.equal((await invoke(this.page, 'run')).error, 'CONFLICT');
  assert.deepEqual(await observations(this), []);
});

Then('a fresh context restores its encrypted backup using {string} with grants inactive', async function (kind) {
  const context = await this.browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await page.goto(`${this.baseURL}/vault-fixture.html`);
    const state = await invoke(page, 'restore', this.vault.backup, kind, kind === 'password' ? canaries[0] : this.vault.recovery);
    assert.equal(state.status.unlocked, true); assert.equal(state.summaries.length, 2);
    assert.ok(state.summaries.every(record => record.grants.length === 0));
    assert.ok(state.summaries.every(record => !Object.hasOwn(record, 'value')));
    assert.deepEqual(await invoke(page, 'persistedCanaries', [...canaries, this.vault.recovery]), []);
    noCanaries(await storage(page, 'read'));
  } finally { await context.close(); }
});

Then('a browser vault request sends its scoped headers without cookies or referrer and scrubs echoes', async function () {
  await this.context.addCookies([{ name: 'ambient', value: 'not-allowed', url: this.baseURL }]);
  const result = await invoke(this.page, 'run');
  assert.equal(result.value.response.status, 200);
  assert.equal(result.value.response.body.accepted, true);
  assert.equal(result.value.response.redacted, true);
  assert.equal(result.value.response.headers['x-api-key'], undefined);
  noCanaries(result);
  const seen = await observations(this);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.authorization, `Bearer ${canaries[1]}`);
  assert.equal(seen[0].headers['x-api-key'], canaries[2]);
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].headers.referer, undefined);
  assert.equal((await invoke(this.page, 'run', true)).error, 'PERMISSION');
  assert.equal((await observations(this)).length, 1, 'operation drift must fail before dispatch');
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', canaries), []);
});

Then('the browser vault rejects the redirect without contacting its target', async function () {
  const result = await invoke(this.page, 'run');
  assert.equal(result.error, 'NETWORK'); noCanaries(result);
  assert.deepEqual((await observations(this)).map(request => request.action), ['redirect']);
  expectedFetchDiagnostics(this);
});

Then('a CORS refusal stops at preflight and exposes no credential or native failure detail', async function () {
  const result = await invoke(this.page, 'run');
  assert.equal(result.error, 'NETWORK'); assert.equal(result.cause, false); noCanaries(result);
  const seen = await observations(this);
  assert.equal(seen.length, 1); assert.equal(seen[0].method, 'OPTIONS');
  assert.equal(seen[0].headers.origin, this.baseURL);
  assert.equal(seen[0].headers.authorization, undefined); assert.equal(seen[0].headers['x-api-key'], undefined);
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', canaries), []);
  const endpoint = `${this.vaultCrossOrigin}/vault-api/${this.vaultRun}/ok`;
  // Match only native messages for the refusal whose real preflight was checked above.
  this.diagnostics = this.diagnostics.filter(item => !(item.type === 'console-error'
    && (item.message.includes(endpoint) && /CORS|access control|Access-Control-Allow-Origin/i.test(item.message)
      || item.location?.url === endpoint && /^Failed to load resource/.test(item.message)))
    && !(this.browser.browserType().name() === 'webkit'
      && (item.type === 'console-error' && item.location?.url === ''
        && item.message === `Origin ${this.baseURL} is not allowed by Access-Control-Allow-Origin. Status code: 200`
        || item.type === 'pageerror' && item.stack === ''
        && item.message === `${endpoint.slice('http:/'.length)} due to access control checks.`)));
});

Then('cancelling the streamed vault request closes it without retrying', async function () {
  await invoke(this.page, 'start');
  await expect.poll(async () => (await observations(this)).length).toBe(1);
  const result = await invoke(this.page, 'cancel');
  assert.equal(result.error, 'CANCELLED'); noCanaries(result);
  await expect.poll(async () => (await observations(this))[0].closed).toBe(true);
  assert.equal((await observations(this)).length, 1);
  assert.equal(await invoke(this.page, 'backup'), this.vault.backup);
  expectedFetchDiagnostics(this);
});

Then('the browser vault stops the oversized response with a safe size error', async function () {
  const result = await invoke(this.page, 'run');
  assert.equal(result.error, 'LIMIT');
  assert.equal(result.cause, false); assert.ok(result.message.length < 256); noCanaries(result);
  assert.deepEqual((await observations(this)).map(request => request.action), [this.vaultAction]);
  assert.equal(await invoke(this.page, 'backup'), this.vault.backup);
  expectedFetchDiagnostics(this);
});

const settings = page => page.getByRole('region', { name: 'Secrets vault', exact: true });
async function openSecrets(page) {
  await setMode(page, 'settings');
  const disclosure = page.locator('summary[aria-label="Secrets"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).getByRole('button', { name: /^(?:Import|Replace) vault$/ })).toBeEnabled();
}
async function unlockUI(page, password = canaries[0]) {
  await settings(page).getByLabel('Unlock password or recovery key', { exact: true }).fill(password);
  await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
}
async function vaultWorkerCount(page) {
  return (await Promise.all(page.workers().map(worker => worker.evaluate(() => globalThis.name).catch(() => 'closed'))))
    .filter(name => name === 'operations-secret-vault').length;
}

async function createUIVault() {
  const page = this.page;
  await openSecrets(page);
  await expect(settings(page).getByText('No vault has been created:', { exact: true })).toBeVisible();
  await expect(settings(page).getByRole('heading', { name: 'Encrypted vault exports', exact: true })).toHaveCount(0);
  await expect(settings(page).getByRole('button', { name: 'Import vault', exact: true })).toBeVisible();
  await expect(settings(page).locator('form input[autocomplete="username"]')).toHaveValue('Operations vault');
  await settings(page).getByLabel('New vault password', { exact: true }).fill(canaries[0]);
  await settings(page).getByLabel('Confirm vault password', { exact: true }).fill(canaries[0]);
  await settings(page).getByRole('button', { name: 'Create vault', exact: true }).click();
  const recovery = settings(page).locator('pre[aria-label="Generated recovery key"]');
  await expect(recovery).toHaveText(/^[A-Za-z0-9+/]{171}=$/);
  assert.equal(await recovery.evaluate(element => element.closest('form')), null);
  await expect(settings(page).getByRole('button', { name: 'Save recovery key', exact: true })).toHaveAttribute('type', 'button');
  this.uiRecovery = await recovery.textContent();
  await page.evaluate(() => {
    window.__recoveryClipboard = "";
    navigator.clipboard.writeText = async value => { window.__recoveryClipboard = value; };
  });
  await settings(page).getByRole('button', { name: 'Copy recovery key', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__recoveryClipboard), this.uiRecovery);
  await page.evaluate(() => { delete navigator.clipboard.writeText; delete window.__recoveryClipboard; });
  assert.equal((await storage(page, 'read')).snapshot, null, 'creation waits for saving the recovery key');
  await expect(settings(page).getByLabel('Verify saved recovery key', { exact: true })).toHaveCount(0);
  const recoveryDownload = page.waitForEvent('download');
  await settings(page).getByRole('button', { name: 'Save recovery key', exact: true }).click();
  assert.equal((await recoveryDownload).suggestedFilename(), 'operations-vault-recovery-key.txt');
  await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
  await expect(settings(page).getByLabel('Confirm action password', { exact: true })).toHaveAttribute('name', 'vault-password');
  await expect(settings(page).locator('.vault-authentication input[autocomplete="username"]')).toHaveValue('Operations vault');
  await settings(page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
  await settings(page).getByLabel('Credential label', { exact: true }).fill(canaries[3]);
  await settings(page).getByLabel('Credential value', { exact: true }).fill(canaries[1]);
  await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(settings(page).getByRole('status')).toContainText('Credential saved', { timeout: 15_000 });
  await expect(settings(page).getByLabel('Credential value', { exact: true })).toHaveValue('');
  await expect(settings(page).getByLabel('Confirm action password', { exact: true })).toHaveValue('');
  await expect(settings(page).locator('li').filter({ hasText: canaries[3] })).toHaveCount(1);
}
Given('I create a vault in the Secrets settings and save a synthetic credential', { timeout: 60_000 }, createUIVault);
Given('I create a synthetic vault on the localhost relying-party origin', { timeout: 60_000 }, async function () {
  this.baseURL = this.baseURL.replace('127.0.0.1', 'localhost');
  await this.context.route(`${this.baseURL}/**`, route => route.continue());
  await this.page.goto(this.baseURL);
  await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await createUIVault.call(this);
});

Then('its registered secret is encrypted and a reload requires unlocking again', async function () {
  noCanaries(await storage(this.page, 'read'));
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', [...canaries, this.uiRecovery]), []);
  await this.page.reload();
  await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await openSecrets(this.page);
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings(this.page).getByText(canaries[3], { exact: true })).toHaveCount(0);
  await unlockUI(this.page);
  await expect(settings(this.page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
});

Then('a vault worker constructor failure remains safe and a later unlock recovers', async function () {
  const page = this.page;
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const before = await storage(page, 'read');
  await page.evaluate(canary => {
    globalThis.vaultOriginalWorker = Worker;
    globalThis.Worker = class extends Worker {
      constructor(url, options) {
        if (options?.name === 'operations-secret-vault') throw new DOMException(canary, 'SecurityError');
        super(url, options);
      }
    };
  }, canaries[1]);
  try {
    await settings(page).getByLabel('Unlock password or recovery key', { exact: true }).fill(canaries[0]);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByRole('alert')).toContainText('unavailable');
    await expect(settings(page).getByLabel('Unlock password or recovery key', { exact: true })).toHaveValue('');
    await expect(settings(page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
    assert.equal(await vaultWorkerCount(page), 0);
    assert.deepEqual(await storage(page, 'read'), before);
    noCanaries(await settings(page).innerText());
    assert.deepEqual(await invoke(page, 'persistedCanaries', canaries), []);
  } finally { await page.evaluate(() => { globalThis.Worker = globalThis.vaultOriginalWorker; delete globalThis.vaultOriginalWorker; }); }
  await unlockUI(page);
  await expect(settings(page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
});

Then('an approved operation shows and copies only scrubbed diagnostics and persists no registered canaries', { timeout: 60_000 }, async function () {
  const page = this.page;
  this.vaultRun = randomUUID();
  const path = `/vault-api/${this.vaultRun}/failure`;
  const document = { openapi: '3.1.0', info: { title: 'Vault diagnostic browser fixture', version: '1.0.0' },
    servers: [{ url: this.baseURL }], components: { securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } } },
    paths: { [path]: { get: {
      operationId: 'vault-diagnostic', summary: 'Vault diagnostic request', security: [{ Bearer: [] }],
      responses: { 422: { description: 'Synthetic refusal', content: { 'application/json': { schema: { type: 'object' } } } } },
    } } },
  };
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'vault-diagnostic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByRole('switch', { name: 'Enable Vault diagnostic browser fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await setMode(page, 'workflow');
  await chooseCatalogOperation(page, 'Vault diagnostic request');
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'Bearer', exact: true }).click();
  await page.getByLabel('Unlock the vault password', { exact: true }).fill(canaries[0]);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('combobox', { name: 'Credential for Bearer', exact: true }).click();
  await page.getByRole('option', { name: canaries[3], exact: true }).click();
  await page.getByLabel('Authenticate to approve changes password', { exact: true }).fill(canaries[0]);
  await page.getByRole('button', { name: 'Approve credential use', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve credential use', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Authenticate to approve changes password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  const response = page.getByRole('region', { name: 'Operation response', exact: true });
  await expect(response).toContainText('HTTP 422');
  await expect(response).toContainText('Synthetic endpoint refusal');
  noCanaries(await response.innerText());
  const seen = await observations(this);
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.authorization, `Bearer ${canaries[1]}`);
  assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers.referer, undefined);
  // The response has no app-specific Copy action. Exercise ordinary native
  // selection + keyboard copy and inspect the real browser clipboard.
  await this.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: this.baseURL });
  await response.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await page.keyboard.press('Control+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /Synthetic endpoint refusal/); noCanaries(copied);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  const errors = await page.evaluate(async () => (await import('/error-history-storage-fixture.js')).readErrors(0, 100));
  noCanaries(errors);
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...canaries, this.uiRecovery]), []);
  this.diagnostics = this.diagnostics.filter(item => !(item.type === 'http-error' && item.url === `${this.baseURL}${path}` && item.status === 422)
    && !(item.type === 'console-error' && /Failed to load resource.*422/.test(item.message) && item.location?.url === `${this.baseURL}${path}`));
});

Then('manually locking the vault clears inputs and password unlocking restores the credential list', async function () {
  await settings(this.page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
  await settings(this.page).getByLabel('Credential value', { exact: true }).fill(canaries[1]);
  const before = await storage(this.page, 'read');
  await this.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings(this.page).getByLabel('Unlock password or recovery key', { exact: true })).toHaveValue('');
  await expect.poll(() => vaultWorkerCount(this.page)).toBe(0);
  await expect.poll(async () => (await storage(this.page, 'read')).lockEpoch).toBe(before.lockEpoch + 1);
  await unlockUI(this.page);
  await expect(settings(this.page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
});

Then('a {string} notification terminates the vault worker and returning visible leaves it locked', async function (event) {
  await this.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(settings(this.page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
  await expect.poll(() => vaultWorkerCount(this.page)).toBe(1);
  await settings(this.page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
  await this.page.evaluate(event => {
    if (event === 'visibilitychange') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event(event));
    } else window.dispatchEvent(new Event('pagehide'));
  }, event);
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect.poll(() => vaultWorkerCount(this.page)).toBe(0);
  await this.page.evaluate(() => {
    Reflect.deleteProperty(document, 'visibilityState'); document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(settings(this.page).getByLabel('Unlock password or recovery key', { exact: true })).toHaveValue('');
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect.poll(() => vaultWorkerCount(this.page)).toBe(0);
});

Then('hiding and restoring the page preserves the vault worker and pending operations', async function () {
  const page = this.page;
  const worker = (await Promise.all(page.workers().map(async worker => ({ worker, name: await worker.evaluate(() => globalThis.name).catch(() => '') }))))
    .find(item => item.name === 'operations-secret-vault').worker;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  try {
    await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
    await expect.poll(() => vaultWorkerCount(page)).toBe(1);
    await settings(page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
    await settings(page).getByLabel('Credential label', { exact: true }).fill('Saved while backgrounded');
    await settings(page).getByLabel('Credential value', { exact: true }).fill(canaries[2]);
    await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
    await expect(settings(page).getByRole('status')).toContainText('Credential saved', { timeout: 15_000 });
    await expect(settings(page).locator('li').filter({ hasText: 'Saved while backgrounded' })).toHaveCount(1);
    assert.equal(await worker.evaluate(() => globalThis.name), 'operations-secret-vault');
  } finally {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
  await expect.poll(() => vaultWorkerCount(page)).toBe(1);
});

Then('optional idle locking expires before a delayed trusted interaction can extend it', async function () {
  const idle = settings(this.page).getByRole('switch', { name: 'Lock after inactivity', exact: true });
  await expect(idle).not.toBeChecked();
  await expect(settings(this.page).getByRole('textbox', { name: 'Minutes of inactivity value', exact: true })).toHaveValue('10');
  await idle.check();
  const minutes = settings(this.page).getByRole('textbox', { name: 'Minutes of inactivity value', exact: true });
  await expect(minutes).toBeEnabled(); await minutes.fill('1'); await minutes.press('Tab');
  await expect(minutes).toBeEnabled();
  // Advance the page wall clock to simulate suspension while keeping the real
  // worker and browser timers; the next trusted event must check before reset.
  await this.page.clock.setFixedTime(new Date(Date.now() + 61_000));
  await this.page.keyboard.press('Shift');
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings(this.page).getByLabel('Unlock password or recovery key', { exact: true })).toHaveValue('');
});

Then('a downloaded vault backup restores with recovery in a fresh application context', async function () {
  await settings(this.page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
  const downloadPromise = this.page.waitForEvent('download');
  await settings(this.page).getByRole('button', { name: 'Export vault', exact: true }).click();
  const download = await downloadPromise, stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks); noCanaries(buffer.toString('utf8'));
  const context = await this.browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await page.goto(this.baseURL); await page.locator('#startup-status').waitFor({ state: 'detached' });
    await openSecrets(page);
    await settings(page).getByLabel('Encrypted vault export', { exact: true }).setInputFiles({ name: 'vault.json', mimeType: 'application/json', buffer });
    const selector = settings(page).getByRole('combobox', { name: 'Export method', exact: true });
    await selector.click(); await page.getByRole('option', { name: 'Recovery key', exact: true }).click();
    await settings(page).getByLabel('Export recovery key', { exact: true }).fill(this.uiRecovery);
    await settings(page).getByRole('button', { name: 'Authenticate and import vault', exact: true }).click();
    await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
    await expect(settings(page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
    await expect(settings(page).getByRole('status')).toContainText('Approve destinations again');
    noCanaries(await storage(page, 'read'));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(settings(page).getByRole('combobox', { name: 'Unlock method', exact: true })).toHaveCount(0);
    const unlockInput = settings(page).getByLabel('Unlock password or recovery key', { exact: true });
    await unlockInput.fill(this.uiRecovery);
    await expect(unlockInput).toHaveAttribute('autocomplete', 'off');
    const inputBox = await unlockInput.boundingBox();
    const unlockBox = await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).boundingBox();
    assert.ok(Math.abs(unlockBox.x - inputBox.x - inputBox.width) < 1);
    assert.equal(unlockBox.y, inputBox.y);
    assert.equal(unlockBox.height, inputBox.height);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
    const previousSnapshot = (await storage(page, 'read')).snapshot;
    await settings(page).getByLabel('Encrypted vault export', { exact: true }).setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer });
    await settings(page).getByLabel('Export password', { exact: true }).fill(canaries[0]);
    await settings(page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
    const beforeReplacement = page.waitForEvent('download');
    await settings(page).getByRole('button', { name: 'Authenticate and replace vault', exact: true }).click();
    const previousDownload = await beforeReplacement;
    assert.equal(previousDownload.suggestedFilename(), 'operations-secrets-vault-before-replacement.json');
    const previousStream = await previousDownload.createReadStream();
    const previousChunks = []; for await (const chunk of previousStream) previousChunks.push(chunk);
    const previousContent = Buffer.concat(previousChunks).toString('utf8');
    assert.deepEqual(JSON.parse(previousContent), previousSnapshot);
    noCanaries(previousContent);
    await expect(settings(page).getByRole('status')).toContainText('Approve destinations again');

  } finally { await context.close(); }
});

const policy = (page, method, ...args) => page.evaluate(async ({ method, args }) => (await import('/vault-policy-fixture.js'))[method](...args), { method, args });
Given('a browser vault worker has an approved credential request for a saved schema', async function () {
  this.vaultRun = randomUUID();
  await this.page.goto(`${this.baseURL}/vault-fixture.html`);
  await policy(this.page, 'setup', this.baseURL, this.vaultRun);
  const result = await policy(this.page, 'execute');
  assert.equal(result.value.response.status, 200);
  assert.equal((await observations(this)).length, 1);
});
Then('a schema {string} makes the old worker request fail before dispatch', async function (mode) {
  await policy(this.page, 'mutate', mode);
  assert.equal((await policy(this.page, 'execute')).error, 'PERMISSION');
  assert.equal((await observations(this)).length, 1, 'stale worker invocation must not dispatch a second request');
});
Then('a legacy catalog without credential policy fails closed until backfilled', async function () {
  await policy(this.page, 'mutate', 'legacy');
  assert.equal((await policy(this.page, 'execute')).error, 'PERMISSION');
  assert.equal((await observations(this)).length, 1);
  assert.equal((await policy(this.page, 'backfill')).value.response.status, 200);
  assert.equal((await observations(this)).length, 2);
});
Then('a schema policy check in a fresh origin fails without creating storage', async function () {
  const context = await this.browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await page.goto(`${this.baseURL}/vault-fixture.html`);
    const result = await policy(page, 'absentDatabase');
    assert.equal(result.error, 'PERMISSION');
    assert.deepEqual(result.before, []); assert.deepEqual(result.after, []);
  } finally { await context.close(); }
});

Then('the production worker bounds the whole HTTP diagnostic before posting it', async function () {
  this.vaultRun = randomUUID();
  await this.page.goto(`${this.baseURL}/vault-fixture.html`);
  await policy(this.page, 'setup', this.baseURL, this.vaultRun, 'huge-failure');
  const reply = await policy(this.page, 'diagnostic');
  assert.equal(reply.ok, false); assert.equal(reply.error.kind, 'response');
  assert.equal(reply.error.response.status, 422);
  assert.match(reply.error.response.body, /diagnostic limit/);
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 16 * 1024);
  noCanaries(reply);
  assert.equal((await observations(this)).length, 1);
  const endpoint = `${this.baseURL}/vault-api/${this.vaultRun}/huge-failure`;
  // The intentional HTTP 422 can also emit this native WebKit console message.
  this.diagnostics = this.diagnostics.filter(item => !(item.type === 'http-error'
    && item.url === endpoint && item.status === 422)
    && !(item.type === 'console-error' && item.location?.url === endpoint
      && item.message === 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)'));
});

Then('the production worker bounds an oversized field diagnostic before posting or dispatching', async function () {
  this.vaultRun = randomUUID();
  await this.page.goto(`${this.baseURL}/vault-fixture.html`);
  await policy(this.page, 'setup', this.baseURL, this.vaultRun, 'field-limit');
  const reply = await policy(this.page, 'diagnostic');
  assert.equal(reply.ok, false); assert.deepEqual(reply.error, { kind: 'vault', code: 'LIMIT' });
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 16 * 1024);
  noCanaries(reply); assert.deepEqual(await observations(this), []);
});

Then('the browser KDF worker matches official and independent vectors and reports the selected profile timings', { timeout: 60_000 }, async function () {
  await this.page.goto(`${this.baseURL}/vault-kdf-fixture.html`);
  const result = await this.page.evaluate(async () => (await import('/vault-kdf-fixture.js')).qualifyKdf());
  assert.equal(result.references, 7); assert.equal(result.comparisons, 3);
  assert.equal(result.applicationKey, 'matched-nonextractable');
  assert.equal(result.warmMs.length, 5);
  await this.attach(JSON.stringify({ ...result, engine: this.browser.browserType().name(), version: this.browser.version(),
    image: process.env.BROWSER_TEST_IMAGE, runnerNode: process.version }), 'application/vnd.operations.vault-kdf+json');
});

async function virtualAuthenticator(world, prf, run, automaticPresenceSimulation = true) {
  assert.equal(world.browser.browserType().name(), 'chromium', 'CDP virtual-authenticator scenarios require Chromium; exclude @chromium-only for other engines');
  const cdp = await world.context.newCDPSession(world.page);
  await cdp.send('WebAuthn.enable');
  // Verified against the official CDP WebAuthn domain and the pinned protocol types.
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'usb', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation,
    hasPrf: prf, hasHmacSecret: prf,
  } });
  try { await run(cdp, authenticatorId); }
  finally { await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }); await cdp.detach(); }
}
Then('the native PRF virtual authenticator enrolls and unlocks the vault without password input', async function () {
  await virtualAuthenticator(this, true, async (cdp, authenticatorId) => {
    const page = this.page;
    await settings(page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
    await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
    await expect(settings(page).getByRole('status')).toContainText('Passkey verified and added');
    const saved = (await storage(page, 'read')).snapshot;
    assert.equal(saved.envelopes.filter(item => item.kind === 'passkey').length, 1);
    const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    assert.equal(credentials.credentials.length, 1);
    assert.equal(credentials.credentials[0].rpId, 'localhost');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await settings(page).getByRole('button', { name: 'Use passkey', exact: true }).click();
    await expect(settings(page).getByLabel('Unlock password or recovery key', { exact: true })).toHaveCount(0);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
    await expect(settings(page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
    noCanaries(await storage(page, 'read'));
    await page.screenshot({ path: 'tmp/test/vault-settings.png', fullPage: true });
    await this.attach(JSON.stringify({ type: 'native-WebAuthn-virtual-authenticator', engine: 'chromium', version: this.browser.version(),
      protocol: 'ctap2_1', hasPrf: true, physicalProviderVerified: false }), 'application/vnd.operations.passkey+json');
  });
});
Then('a native virtual authenticator without PRF leaves password and recovery methods usable', async function () {
  await virtualAuthenticator(this, false, async () => {
    const page = this.page, before = await storage(page, 'read');
    await settings(page).getByLabel('Confirm action password', { exact: true }).fill(canaries[0]);
    await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
    await expect(settings(page).getByRole('alert')).toContainText('unavailable');
    assert.deepEqual(await storage(page, 'read'), before);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await unlockUI(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await settings(page).getByLabel('Unlock password or recovery key', { exact: true }).fill(this.uiRecovery);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
  });
});

Then('a pending native passkey enrollment is cancelled by {string} and clears retained input elements', async function (action) {
  await virtualAuthenticator(this, true, async (cdp, authenticatorId) => {
    const page = this.page, before = await storage(page, 'read');
    const password = settings(page).getByLabel('Confirm action password', { exact: true });
    const value = settings(page).getByLabel('Credential value', { exact: true });
    await password.fill(canaries[0]); await value.fill(canaries[1]);
    const handles = await Promise.all([password.elementHandle(), value.elementHandle()]);
    try {
      await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
      await expect(settings(page).getByRole('status')).toContainText('Verifying passkey');
      if (action === 'manual lock') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      else if (action === 'settings teardown') { await page.locator('summary[aria-label="Secrets"]').click(); await expect(settings(page)).toHaveCount(0); }
      else throw new Error('Unknown cancellation action');
      for (const handle of handles) assert.equal(await handle.evaluate(input => input.value), '', 'detached sensitive inputs must also be cleared');
      await expect.poll(() => vaultWorkerCount(page)).toBe(0);
      // Re-enable presence only after cancellation; the abandoned ceremony must
      // neither create a credential nor add a vault method afterward.
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: true });
      await openSecrets(page);
      await expect(settings(page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
      await unlockUI(page);
      assert.deepEqual((await storage(page, 'read')).snapshot, before.snapshot);
      assert.equal((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length, 0);
      await expect(settings(page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
    } finally { for (const handle of handles) await handle.dispose(); }
  }, false);
});
