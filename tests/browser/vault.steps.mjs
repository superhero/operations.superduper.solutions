// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { exampleCatalogState } from './catalog-state.fixture.mjs';
import { chooseCatalogOperation, setMode } from './workspace.fixture.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { jiraCanaries } from '../jira-companion.fixture.mjs';
import { createUtilityNode } from '../../src/lib/workflow-graph.ts';
import { awsSyntheticValues, verifyAwsSignature } from '../aws-sigv4.fixture.mjs';
import { s3FixtureChecksums, s3CorsLogicalUrl } from './s3-cors-endpoint.fixture.mjs';
import { signAwsRequest } from '../../src/lib/secrets/aws-sigv4.ts';

const fixture = '/vault-storage-fixture.js';
const canaries = ['browser-VAULT-password-9182', 'browser-BEARER-canary-9182', 'browser-APIKEY-canary-9182', 'browser-PRIVATE-label-9182'];
const privateCanaries = canaries.slice(0, 3);
const invoke = (page, method, ...args) => page.evaluate(async ({ fixture, method, args }) => (await import(fixture))[method](...args), { fixture, method, args });
const storage = (page, action, ...args) => page.evaluate(async ({ fixture, action, args }) => (await import(fixture)).createVaultStorage()[action](...args), { fixture, action, args });
const observations = async world => (await world.context.request.get(`${world.baseURL}/vault-api/${world.vaultRun}/observations`)).json();
function noCanaries(value) {
  for (const canary of privateCanaries) assert.ok(!JSON.stringify(value).includes(canary), 'A registered private field crossed the inspected boundary');
}
async function seed(world, action) {
  world.vaultRun = randomUUID(); world.vaultAction = action;
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
  this.vault = await invoke(this.page, 'seed', this.vaultCrossOrigin, this.vaultRun, 'ok');
});

Then('its database exposes key names while stored values and exports remain encrypted', async function () {
  const stored = await storage(this.page, 'read');
  assert.equal(stored.snapshot.version, 1);
  assert.equal(stored.snapshot.records.length, 2);
  assert.equal(stored.snapshot.envelopes.length, 2);
  assert.ok(stored.snapshot.records.every(record => record.ciphertext.data.length > 40));
  noCanaries(stored); noCanaries(this.vault.backup);
  assert.ok(stored.keys.some(key => key.label === canaries[3]));
  assert.ok(!this.vault.backup.includes(canaries[3]));
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', [...privateCanaries, this.vault.recovery]), []);
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
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', privateCanaries), []);
});

Then('a blocked native database open fails within its deadline without recreating deleted storage', async function () {
  const result = await invoke(this.page, 'blockedOpen');
  assert.equal(result.result.error, 'UNAVAILABLE'); assert.equal(result.result.cause, false);
  assert.equal(result.unchanged, true); assert.equal(result.recreated, false);
  assert.ok(result.elapsed >= 2000 && result.elapsed < 10_000, 'blocked open must have a bounded failure');
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', privateCanaries), []);
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
    assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, this.vault.recovery]), []);
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
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', privateCanaries), []);
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
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', privateCanaries), []);
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
Then('a Telegram connection at {int} pixels supplies its private token only to the worker request', { timeout: 60_000 }, async function (width) {
  const page = this.page, token = '123456789:browser_TELEGRAM_canary_9182';
  await page.setViewportSize({ width, height: 900 });
  await invoke(page, 'seedTelegram', this.baseURL, randomUUID());
  const seen = [];
  await this.context.route('https://api.telegram.org/**', async route => {
    const request = route.request(), headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': '*' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    seen.push({ url: request.url(), method: request.method(), headers: request.headers() });
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ok: true, result: { id: 42, is_bot: true, first_name: 'Fixture bot' } }) });
  });
  const name = 'Get private bot identity';
  const document = { openapi: '3.1.0', info: { title: 'Telegram private path fixture', version: '1' },
    servers: [{ url: 'https://api.telegram.org/bot{botToken}', variables: { botToken: { default: '<bot_token>' } } }],
    paths: { '/getMe': { post: { operationId: 'getMe', summary: name, 'x-operations-private-path': 'telegram-bot',
      responses: { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
  await setMode(page, 'settings'); const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'telegram-private.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable Telegram private path fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'Bot token', exact: true }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('combobox', { name: 'Credential for Bot token', exact: true }).click();
  await page.getByRole('option', { name: 'Telegram bot fixture', exact: true }).click();
  await page.getByText('Save as connection', { exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('Telegram connection');
  await page.getByLabel('Account label', { exact: true }).fill('Test bot');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  const connection = page.getByRole('combobox', { name: 'Saved HTTP connection', exact: true });
  await expect(connection).toContainText('Telegram connection · Test bot');
  const binding = async () => (await repository(page, 'list')).flatMap(document => document.nodes).find(node => node.data?.name === name)?.data.credentialBinding;
  await expect.poll(async () => (await binding())?.connection?.revision).toBe(1);
  assert.deepEqual((await binding()).credentials, {}); assert.equal(seen.length, 0);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(connection).toContainText('Telegram connection · Test bot'); await expect(connection).toBeEnabled();
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  assert.equal(seen.length, 1); assert.equal(seen[0].method, 'POST'); assert.equal(seen[0].url, 'https://api.telegram.org/bot'+token+'/getMe');
  assert.equal(seen[0].headers.authorization, undefined); assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers.referer, undefined);
  const errors = await page.evaluate(async () => (await import('/error-history-storage-fixture.js')).readErrors(0, 100));
  for (const value of [await page.locator('body').innerText(), await repository(page, 'list'), errors, document]) {
    for (const secret of [token, token.replace(':', '%3A'), token.replace(':', '%3a'), token.replace(':', '%253A')]) assert.ok(!JSON.stringify(value).includes(secret));
  }
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, token, encodeURIComponent(token)]), []);
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/telegram-private-${width}.png` });
});
Then('a saved HTTP connection at {int} pixels can be edited re-unlocked and reused without reselecting keys', { timeout: 60_000 }, async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 900 });
  await seed(this, 'ok');
  const name = 'Saved connection request', path = `/vault-api/${this.vaultRun}/ok`;
  const document = { openapi: '3.1.0', info: { title: 'Saved HTTP connection fixture', version: '1' }, servers: [{ url: this.baseURL }],
    components: { securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } } },
    paths: { [path]: { get: { operationId: 'saved-connection', summary: name, security: [{ Bearer: [] }],
      responses: { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'saved-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable Saved HTTP connection fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'Bearer', exact: true }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const credential = page.getByRole('combobox', { name: 'Credential for Bearer', exact: true });
  await expect(credential).toBeEnabled(); await credential.click();
  await page.getByRole('option', { name: canaries[3], exact: true }).click();
  await page.getByText('Save as connection', { exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('Reusable test connection');
  await page.getByLabel('Account label', { exact: true }).fill('Test account A');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  const connections = page.getByRole('combobox', { name: 'Saved HTTP connection', exact: true });
  await expect(connections).toContainText('Reusable test connection · Test account A');
  await expect(credential).toHaveCount(0);
  await page.getByLabel('Account label', { exact: true }).fill('Test account B');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(connections).toContainText('Reusable test connection · Test account B');
  const savedBinding = async () => (await repository(page, 'list')).flatMap(document => document.nodes)
    .find(node => node.data?.name === name)?.data.credentialBinding;
  await expect.poll(async () => (await savedBinding())?.connection?.revision).toBe(2);
  const saved = await savedBinding(); assert.deepEqual(saved.credentials, {});
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(connections).toContainText('Reusable test connection · Test account B');
  await expect(connections).toBeEnabled(); await expect(credential).toHaveCount(0);
  assert.deepEqual(await savedBinding(), saved);
  assert.ok(await page.locator('.http-connections').evaluate(element => element.scrollWidth <= element.clientWidth+1));
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect.poll(async () => (await observations(this)).length).toBe(1);
  assert.equal((await observations(this))[0].headers.authorization, `Bearer ${canaries[1]}`);
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  noCanaries(await page.locator('body').innerText());
  assert.deepEqual(await invoke(page, 'persistedCanaries', privateCanaries), []);
  if (width === 1280) {
    await page.getByRole('button', { name: 'Quit', exact: true }).click();
    const document = (await repository(page, 'list')).find(document => document.nodes.some(node => node.data?.name === name));
    const state = await repository(page, 'load', document.id);
    state.document.nodes.find(node => node.data?.name === name).data.credentialBinding.fingerprint = '0'.repeat(64);
    await repository(page, 'save', state.document, state.revision, 'Exercise an obsolete operation approval');
    await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
    await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    const alternative = page.getByRole('combobox', { name: 'Authentication alternative', exact: true });
    await expect(alternative).toBeVisible(); await alternative.click();
    await page.getByRole('option', { name: 'Bearer', exact: true }).click();
    await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(connections).toBeEnabled(); await connections.click();
    await page.getByRole('option', { name: 'Reusable test connection · Test account B', exact: true }).click();
    await expect.poll(async () => (await savedBinding())?.fingerprint).not.toBe('0'.repeat(64));
    assert.equal((await observations(this)).length, 1, 'Reselecting a changed operation must not run it.');
  }
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/saved-connection-${width}.png` });
});
async function openSecrets(page) {
  await setMode(page, 'settings');
  const disclosure = page.locator('summary[aria-label="Secrets"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).getByRole('button', { name: /^(?:Import|Replace) vault$/ })).toBeEnabled();
}
async function unlockUI(page, password = canaries[0]) {
  await settings(page).getByLabel('Unlock password, or recovery key', { exact: true }).fill(password);
  await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
}
async function vaultWorkerCount(page) {
  return (await Promise.all(page.workers().map(worker => worker.evaluate(() => globalThis.name).catch(() => 'closed'))))
    .filter(name => name === 'operations-secret-vault').length;
}

async function createUIVault(checkManagement = false) {
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
  if (checkManagement) {
    await page.evaluate(() => {
      window.__recoveryClipboard = "";
      navigator.clipboard.writeText = async value => { window.__recoveryClipboard = value; };
    });
    await settings(page).getByRole('button', { name: 'Copy recovery key', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__recoveryClipboard), this.uiRecovery);
    await page.evaluate(() => { delete navigator.clipboard.writeText; delete window.__recoveryClipboard; });
  }
  assert.equal((await storage(page, 'read')).snapshot, null, 'creation waits for saving the recovery key');
  await expect(settings(page).getByLabel('Verify saved recovery key', { exact: true })).toHaveCount(0);
  const recoveryDownload = page.waitForEvent('download');
  await settings(page).getByRole('button', { name: 'Save recovery key', exact: true }).click();
  assert.equal((await recoveryDownload).suggestedFilename(), 'operations-vault-recovery-key.txt');
  await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
  await settings(page).getByLabel('Credential label', { exact: true }).fill(canaries[3]);
  await settings(page).getByLabel('Credential value', { exact: true }).fill(canaries[1]);
  await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(settings(page).getByLabel('Credential label', { exact: true })).toHaveValue('', { timeout: 15_000 });
  if (checkManagement) {
    const savedRow = settings(page).locator('li').filter({ hasText: canaries[3] });
    await expect(savedRow.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
    await page.evaluate(() => { navigator.clipboard.writeText = async value => { window.__credentialClipboard = value; }; });
    try {
      await savedRow.getByRole('button', { name: 'Copy', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__credentialClipboard)).toBe(canaries[1]);
    } finally {
      await page.evaluate(() => { delete navigator.clipboard.writeText; delete window.__credentialClipboard; });
    }

    await expect(settings(page).getByRole('button', { name: 'Generate recovery key', exact: true })).toHaveCount(0);
    await expect(settings(page).getByRole('combobox', { name: 'Recovery method to replace', exact: true })).toHaveCount(0);
    const beforePasskey = await storage(page, 'read');
    await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
    const passkeyForm = settings(page).locator('form[id$="-passkey"]');
    await expect(passkeyForm.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(passkeyForm.getByRole('combobox')).toHaveCount(0);
    await passkeyForm.getByLabel('Password', { exact: true }).fill(canaries[0]);
    const passkeyInputHandle = await passkeyForm.getByLabel('Password', { exact: true }).elementHandle();
    await settings(page).locator('.vault-passkey-row').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(passkeyForm).toHaveCount(0);
    assert.equal(await passkeyInputHandle.evaluate(input => input.value), '');
    assert.deepEqual(await storage(page, 'read'), beforePasskey);
    const beforeRotation = await storage(page, 'read');
    await settings(page).getByRole('button', { name: 'Rotate key', exact: true }).click();
    const cancelRotation = settings(page).locator('.vault-rotate-row').getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancelRotation).toHaveAttribute('aria-expanded', 'true');
    await expect(settings(page).locator('.rotation-body')).toBeVisible();
    await expect(settings(page).locator('.rotation-body').getByRole('button', { name: 'Rotate key', exact: true })).toBeVisible();
    await cancelRotation.click();
    await expect(settings(page).locator('.rotation-body')).toHaveCount(0);
    assert.deepEqual(await storage(page, 'read'), beforeRotation);
    await settings(page).getByRole('button', { name: 'Rotate key', exact: true }).click();
    const rotationFields = settings(page).locator('.rotation-body');
    await expect(rotationFields.getByRole('combobox')).toHaveCount(0);
    await expect(rotationFields.locator('input[type="password"]')).toHaveCount(1);
    await rotationFields.locator('input[type="password"]').fill(canaries[0]);
    const automaticRecoveryDownload = page.waitForEvent('download');
    await rotationFields.getByRole('button', { name: 'Rotate key', exact: true }).click();
    const automaticDownload = await automaticRecoveryDownload;
    assert.equal(automaticDownload.suggestedFilename(), 'operations-vault-recovery-key.txt');
    const rotatedRecovery = settings(page).locator('pre[aria-label="Generated recovery key"]');
    await expect(rotatedRecovery).toHaveText(/^[A-Za-z0-9+/]{171}=$/);
    const oldRecovery = this.uiRecovery;
    this.uiRecovery = await rotatedRecovery.textContent();
    assert.notEqual(this.uiRecovery, oldRecovery);
    const recoveryStream = await automaticDownload.createReadStream();
    const recoveryChunks = []; for await (const chunk of recoveryStream) recoveryChunks.push(chunk);
    assert.equal(Buffer.concat(recoveryChunks).toString('utf8'), this.uiRecovery + '\n');
    const rotatedKeyDownload = page.waitForEvent('download');
    await settings(page).getByRole('button', { name: 'Save recovery key', exact: true }).click();
    await rotatedKeyDownload;
    await expect(rotatedRecovery).toHaveCount(0);
  }

  await expect(settings(page).getByLabel('Credential value', { exact: true })).toHaveValue('');
  await expect(settings(page).locator('li').filter({ hasText: canaries[3] })).toHaveCount(1);
}
Given('I create a vault in the Secrets settings and save a synthetic credential', { timeout: 60_000 }, async function () { await createUIVault.call(this); });
Given('I exercise vault creation, copying and key management with a synthetic credential', { timeout: 60_000 }, async function () {
  await createUIVault.call(this, true);
});
Given('I create a synthetic vault on the localhost relying-party origin', { timeout: 60_000 }, async function () {
  this.baseURL = this.baseURL.replace('127.0.0.1', 'localhost');
  await this.context.route(`${this.baseURL}/**`, route => route.continue());
  await this.page.goto(this.baseURL);
  await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await createUIVault.call(this);
});

Then('its registered secret is encrypted and a reload requires unlocking again', async function () {
  noCanaries(await storage(this.page, 'read'));
  assert.deepEqual(await invoke(this.page, 'persistedCanaries', [...privateCanaries, this.uiRecovery]), []);
  await this.page.reload();
  await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await openSecrets(this.page);
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings(this.page).getByText(canaries[3], { exact: true })).toHaveCount(1);
  const row = settings(this.page).locator('li').filter({ hasText: canaries[3] });
  await expect(row.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
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
    await settings(page).getByLabel('Unlock password, or recovery key', { exact: true }).fill(canaries[0]);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByRole('alert')).toContainText('unavailable');
    await expect(settings(page).getByLabel('Unlock password, or recovery key', { exact: true })).toHaveValue('');
    await expect(settings(page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
    assert.equal(await vaultWorkerCount(page), 0);
    assert.deepEqual(await storage(page, 'read'), before);
    noCanaries(await settings(page).innerText());
    assert.deepEqual(await invoke(page, 'persistedCanaries', privateCanaries), []);
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
  await expect(page.getByRole('button', { name: 'Approve credential use', exact: true })).toHaveCount(0);
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
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, this.uiRecovery]), []);
  this.diagnostics = this.diagnostics.filter(item => !(item.type === 'http-error' && item.url === `${this.baseURL}${path}` && item.status === 422)
    && !(item.type === 'console-error' && /Failed to load resource.*422/.test(item.message) && item.location?.url === `${this.baseURL}${path}`));
});

Then('an unsupported first authentication choice stays disabled while a later saved token choice survives reload and executes privately', { timeout: 90_000 }, async function () {
  const page = this.page;
  this.vaultRun = randomUUID();
  const path = `/vault-api/${this.vaultRun}/ok`;
  const document = { openapi: '3.1.0', info: { title: 'Partial authentication fixture', version: '1' },
    servers: [{ url: this.baseURL }], components: { securitySchemes: {
      Digest: { type: 'http', scheme: 'digest' }, Bearer: { type: 'http', scheme: 'bearer' },
    } }, paths: { [path]: { get: { operationId: 'partial-auth', summary: 'Partial auth request',
      security: [{ Digest: [] }, { Bearer: [] }], responses: { 200: { description: 'Synthetic result',
        content: { 'application/json': { schema: { type: 'object' } } } } },
    } } } };
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'partial-auth.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByRole('switch', { name: 'Enable Partial authentication fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await setMode(page, 'workflow');
  await chooseCatalogOperation(page, 'Partial auth request');
  const alternatives = page.getByRole('combobox', { name: 'Authentication alternative', exact: true });
  await alternatives.click();
  await expect(page.getByRole('option', { name: 'Digest', exact: true })).toBeDisabled();
  await expect(page.getByRole('option', { name: 'Bearer', exact: true })).toBeEnabled();
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/auth-alternatives.png` });
  await page.getByRole('option', { name: 'Bearer', exact: true }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  if (await unlock.isVisible()) {
    await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  }
  const credential = page.getByRole('combobox', { name: 'Credential for Bearer', exact: true });
  await credential.click(); await page.getByRole('option', { name: canaries[3], exact: true }).click();
  const savedBinding = async () => {
    const documents = await repository(page, 'list');
    return documents.flatMap(document => document.nodes).find(node => node.data?.name === 'Partial auth request')?.data.credentialBinding;
  };
  await expect.poll(async () => (await savedBinding())?.alternative).toBe(1);
  const saved = await savedBinding();
  assert.match(saved.credentials.Bearer, /^[a-f0-9-]{36}$/);
  assert.ok(!JSON.stringify(saved).includes(canaries[1]));
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(alternatives).toContainText('Bearer');
  await expect(credential).toContainText(canaries[3]);
  assert.deepEqual(await savedBinding(), saved, 'Reload keeps the original alternative and vault reference.');
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(unlock).toHaveCount(0);
  await expect(credential).toBeEnabled();
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect.poll(async () => (await observations(this)).length).toBe(1);
  const seen = (await observations(this))[0];
  assert.equal(seen.headers.authorization, `Bearer ${canaries[1]}`);
  assert.equal(seen.headers.cookie, undefined);
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('HTTP 200');
  noCanaries(await page.locator('body').innerText());
  assert.deepEqual(await invoke(page, 'persistedCanaries', privateCanaries), []);
});

Then('a Basic username and token selection survives reload and only its private request receives the encoded credentials', { timeout: 90_000 }, async function () {
  const page = this.page, username = 'basic-PRIVATE-user-9182@example.test', userLabel = 'Basic username';
  await settings(page).getByLabel('Credential label', { exact: true }).fill(userLabel);
  await settings(page).getByLabel('Credential value', { exact: true }).fill(username);
  await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(settings(page).getByLabel('Credential label', { exact: true })).toHaveValue('');
  this.vaultRun = randomUUID();
  const path = `/vault-api/${this.vaultRun}/ok`, encoded = Buffer.from(`${username}:${canaries[1]}`, 'ascii').toString('base64');
  const privateValues = [...privateCanaries, username, `${username}:${canaries[1]}`, encoded, `Basic ${encoded}`];
  const document = { openapi: '3.1.0', info: { title: 'Basic auth fixture', version: '1' }, servers: [{ url: this.baseURL }],
    components: { securitySchemes: { Login: { type: 'http', scheme: 'basic' } } }, paths: { [path]: { get: {
      operationId: 'basic-auth', summary: 'Private Basic request', security: [{ Login: [] }],
      responses: { 200: { description: 'Synthetic result', content: { 'application/json': { schema: { type: 'object' } } } } },
    } } } };
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'basic-auth.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByRole('switch', { name: 'Enable Basic auth fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await setMode(page, 'workflow'); await chooseCatalogOperation(page, 'Private Basic request');
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'Login', exact: true }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  if (await unlock.isVisible()) {
    await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(unlock).toHaveCount(0);
  }
  const user = page.getByRole('combobox', { name: 'Username for Login', exact: true });
  const token = page.getByRole('combobox', { name: 'Password or token for Login', exact: true });
  await user.click(); await page.getByRole('option', { name: userLabel, exact: true }).click();
  await token.click(); await page.getByRole('option', { name: canaries[3], exact: true }).click();
  const savedBinding = async () => (await repository(page, 'list')).flatMap(document => document.nodes)
    .find(node => node.data?.name === 'Private Basic request')?.data.credentialBinding;
  await expect.poll(async () => Object.keys((await savedBinding())?.credentials.Login ?? {}).sort().join(',')).toBe('password,username');
  const saved = await savedBinding();
  assert.equal(saved.alternative, 0);
  for (const id of Object.values(saved.credentials.Login)) assert.match(id, /^[a-f0-9-]{36}$/);
  for (const value of privateValues) assert.ok(!JSON.stringify(saved).includes(value));
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/basic-selection.png` });
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(user).toContainText(userLabel); await expect(token).toContainText(canaries[3]);
  assert.deepEqual(await savedBinding(), saved);
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(unlock).toHaveCount(0); await expect(token).toBeEnabled();
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  const seen = await observations(this);
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.authorization, `Basic ${encoded}`);
  assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers.referer, undefined);
  await expect(page.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('HTTP 200');
  const visible = await page.locator('body').innerText();
  for (const value of privateValues) assert.ok(!visible.includes(value), 'A Basic value escaped onto the page.');
  assert.deepEqual(await invoke(page, 'persistedCanaries', privateValues), []);
});

Then('manually locking the vault clears inputs and password unlocking restores the credential list', async function () {
  await settings(this.page).getByLabel('Credential value', { exact: true }).fill(canaries[1]);
  const before = await storage(this.page, 'read');
  await this.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings(this.page).getByLabel('Unlock password, or recovery key', { exact: true })).toHaveValue('');
  await expect.poll(() => vaultWorkerCount(this.page)).toBe(0);
  assert.deepEqual(await storage(this.page, 'read'), before, 'Page exit discards access without writing vault data.');
  await unlockUI(this.page);
  await expect(settings(this.page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
});

Then('a {string} notification terminates the vault worker and returning visible leaves it locked', async function (event) {
  await this.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(settings(this.page).getByLabel('Credential label', { exact: true })).toBeVisible();
  await expect.poll(() => vaultWorkerCount(this.page)).toBe(1);
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
  await expect(settings(this.page).getByLabel('Unlock password, or recovery key', { exact: true })).toHaveValue('');
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
    await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
    await expect.poll(() => vaultWorkerCount(page)).toBe(1);
    await settings(page).getByLabel('Credential label', { exact: true }).fill('Saved while backgrounded');
    await settings(page).getByLabel('Credential value', { exact: true }).fill(canaries[2]);
    await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
    await expect(settings(page).getByLabel('Credential label', { exact: true })).toHaveValue('', { timeout: 15_000 });
    await expect(settings(page).locator('li').filter({ hasText: 'Saved while backgrounded' })).toHaveCount(1);
    assert.equal(await worker.evaluate(() => globalThis.name), 'operations-secret-vault');
  } finally {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
  await expect.poll(() => vaultWorkerCount(page)).toBe(1);
});

Then('optional idle locking expires before a delayed trusted interaction can extend it', async function () {
  const idle = settings(this.page).getByRole('switch', { name: 'Lock after inactivity', exact: true });
  await expect(idle).not.toBeChecked();
  await expect(settings(this.page).getByRole('textbox', { name: 'Minutes of inactivity value', exact: true })).toHaveValue('10');
  await idle.click();
  await expect(idle).toBeChecked();
  const minutes = settings(this.page).getByRole('textbox', { name: 'Minutes of inactivity value', exact: true });
  await expect(minutes).toBeEnabled(); await minutes.fill('1'); await minutes.press('Tab');
  await expect(minutes).toBeEnabled();
  // Advance the page wall clock to simulate suspension while keeping the real
  // worker and browser timers; the next trusted event must check before reset.
  await this.page.clock.setFixedTime(new Date(Date.now() + 61_000));
  await this.page.keyboard.press('Shift');
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings(this.page).getByLabel('Unlock password, or recovery key', { exact: true })).toHaveValue('');
});

Then('a downloaded vault backup restores with recovery in a fresh application context', async function () {
  await this.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  const downloadPromise = this.page.waitForEvent('download');
  await settings(this.page).getByRole('button', { name: 'Export vault', exact: true }).click();
  const download = await downloadPromise, stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks); noCanaries(buffer.toString('utf8'));
  await expect(settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  const context = await this.browser.newContext({ storageState: exampleCatalogState(this.baseURL), viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await page.goto(this.baseURL); await page.locator('#startup-status').waitFor({ state: 'detached' });
    await openSecrets(page);
    await settings(page).getByLabel('Encrypted vault export', { exact: true }).setInputFiles({ name: 'vault.json', mimeType: 'application/json', buffer });
    const selector = settings(page).getByRole('combobox', { name: 'Export method', exact: true });
    await selector.click(); await page.getByRole('option', { name: 'Recovery key', exact: true }).click();
    await settings(page).getByLabel('Export recovery key', { exact: true }).fill(this.uiRecovery);
    await settings(page).getByRole('button', { name: 'Authenticate and import vault', exact: true }).click();
    await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
    await expect(settings(page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
    await expect(settings(page).getByRole('status')).toContainText('Vault imported.');
    noCanaries(await storage(page, 'read'));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(settings(page).getByRole('combobox', { name: 'Unlock method', exact: true })).toHaveCount(0);
    const unlockInput = settings(page).getByLabel('Unlock password, or recovery key', { exact: true });
    await unlockInput.fill(this.uiRecovery);
    await expect(unlockInput).toHaveAttribute('autocomplete', 'off');
    const { inputBox, unlockBox } = await unlockInput.evaluate(input => {
      const box = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
      return { inputBox: box(input), unlockBox: box(input.parentElement.querySelector('button')) };
    });
    assert.ok(Math.abs(unlockBox.x - inputBox.x - inputBox.width) < 1);
    assert.equal(unlockBox.y, inputBox.y);
    assert.equal(unlockBox.height, inputBox.height);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
    const previousSnapshot = (await storage(page, 'read')).snapshot;
    await settings(page).getByLabel('Encrypted vault export', { exact: true }).setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer });
    await settings(page).getByLabel('Export password', { exact: true }).fill(canaries[0]);
    await settings(page).getByLabel('Password, or recovery key for the current vault', { exact: true }).fill(canaries[0]);
    const beforeReplacement = page.waitForEvent('download');
    await settings(page).getByRole('button', { name: 'Authenticate and replace vault', exact: true }).click();
    const previousDownload = await beforeReplacement;
    assert.equal(previousDownload.suggestedFilename(), 'operations-secrets-vault-before-replacement.json');
    const previousStream = await previousDownload.createReadStream();
    const previousChunks = []; for await (const chunk of previousStream) previousChunks.push(chunk);
    const previousContent = Buffer.concat(previousChunks).toString('utf8');
    assert.deepEqual(JSON.parse(previousContent), previousSnapshot);
    noCanaries(previousContent);
    await expect(settings(page).getByRole('status')).toContainText('Vault imported.');

  } finally { await context.close(); }
});

const policy = (page, method, ...args) => page.evaluate(async ({ method, args }) => (await import('/vault-policy-fixture.js'))[method](...args), { method, args });
Then('production connection references survive worker replacement and reject account edits and disabled schemas', async function () {
  this.vaultRun = randomUUID();
  const result = await policy(this.page, 'connectionRoundtrip', this.baseURL, this.vaultRun);
  noCanaries(result);
  assert.equal(result.first.response.status, 200); assert.equal(result.second.response.status, 200);
  assert.deepEqual(result.restored, result.selected); assert.deepEqual(result.restored.credentials, {});
  assert.equal(result.profiles.length, 1); assert.equal(result.edited.revision, 2);
  assert.equal(result.stale, 'PERMISSION'); assert.equal(result.disabled, 'PERMISSION'); assert.equal(result.encryptedMetadata, true);
  assert.equal((await observations(this)).length, 2, 'Stale account and disabled schema requests must not dispatch.');
});
Then('production vault stream progress contains counts only and its terminal result is scrubbed', async function () {
  this.vaultRun = randomUUID();
  const result = await policy(this.page, 'streamedClient', this.baseURL, this.vaultRun);
  noCanaries(result);
  assert.equal(result.value.response.status, 200);
  assert.equal(result.value.response.mediaType, 'application/json');
  assert.equal(result.value.response.transportMediaType, 'text/event-stream');
  assert.equal(result.value.response.redacted, true);
  assert.equal(result.value.response.body.id, 'resp_worker_fixture');
  assert.match(result.value.response.body.output[0].content[0].text, /^safe .* tail$/);
  assert.ok(result.progress.length >= 2);
  for (const progress of result.progress) {
    assert.deepEqual(Object.keys(progress).sort(), ['bytes', 'events']);
    assert.ok(Number.isSafeInteger(progress.bytes) && Number.isSafeInteger(progress.events));
  }
  assert.equal(result.progress.at(-1).events, 2);
  await expect.poll(async () => (await observations(this))[0].closed).toBe(true);
  assert.equal((await observations(this)).length, 1, 'The production client must not reconnect the stream.');
});
Given('a browser vault worker has an approved credential request for a saved schema', async function () {
  this.vaultRun = randomUUID();
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
  await policy(this.page, 'setup', this.baseURL, this.vaultRun, 'field-limit');
  const reply = await policy(this.page, 'diagnostic');
  assert.equal(reply.ok, false); assert.deepEqual(reply.error, { kind: 'vault', code: 'LIMIT' });
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 16 * 1024);
  noCanaries(reply); assert.deepEqual(await observations(this), []);
});

Then('the browser KDF worker matches official and independent vectors and reports the selected profile timings', { timeout: 60_000 }, async function () {
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
    await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
      await settings(page).locator('form[id$="-passkey"]').getByLabel('Password', { exact: true }).fill(canaries[0]);
      await settings(page).locator('form[id$="-passkey"]').getByRole('button', { name: 'Verify and add passkey', exact: true }).click();
    await expect(settings(page).getByRole('status')).toContainText('Passkey verified and added');
    const saved = (await storage(page, 'read')).snapshot;
    assert.equal(saved.envelopes.filter(item => item.kind === 'passkey').length, 1);
    const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    assert.equal(credentials.credentials.length, 1);
    assert.equal(credentials.credentials[0].rpId, 'localhost');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await settings(page).getByRole('button', { name: 'Use passkey', exact: true }).click();
    await expect(settings(page).getByLabel('Unlock password, or recovery key', { exact: true })).toHaveCount(0);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
    await expect(settings(page).locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
    noCanaries(await storage(page, 'read'));
    await this.attach(JSON.stringify({ type: 'native-WebAuthn-virtual-authenticator', engine: 'chromium', version: this.browser.version(),
      protocol: 'ctap2_1', hasPrf: true, physicalProviderVerified: false }), 'application/vnd.operations.passkey+json');
  });
});
Then('a native virtual authenticator without PRF leaves password and recovery methods usable', async function () {
  await virtualAuthenticator(this, false, async () => {
    const page = this.page, before = await storage(page, 'read');
    await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
      await settings(page).locator('form[id$="-passkey"]').getByLabel('Password', { exact: true }).fill(canaries[0]);
      await settings(page).locator('form[id$="-passkey"]').getByRole('button', { name: 'Verify and add passkey', exact: true }).click();
    await expect(settings(page).locator('form[id$="-passkey"]').getByRole('alert')).toHaveText('Passkey encryption (WebAuthn PRF) is unavailable in this browser or passkey provider. Your existing vault is unchanged.');
    assert.deepEqual(await storage(page, 'read'), before);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await unlockUI(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await settings(page).getByLabel('Unlock password, or recovery key', { exact: true }).fill(this.uiRecovery);
    await settings(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(settings(page).getByLabel('Credential label', { exact: true })).toBeVisible();
  });
});

Then('a pending native passkey enrollment is cancelled by {string} and clears retained input elements', async function (action) {
  await virtualAuthenticator(this, true, async (cdp, authenticatorId) => {
    const page = this.page, before = await storage(page, 'read');
    await settings(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
    const password = settings(page).locator('form[id$="-passkey"]').getByLabel('Password', { exact: true });
    const value = settings(page).getByLabel('Credential value', { exact: true });
    await password.fill(canaries[0]); await value.fill(canaries[1]);
    const handles = await Promise.all([password.elementHandle(), value.elementHandle()]);
    try {
      await settings(page).locator('form[id$="-passkey"]').getByLabel('Password', { exact: true }).fill(canaries[0]);
      await settings(page).locator('form[id$="-passkey"]').getByRole('button', { name: 'Verify and add passkey', exact: true }).click();
      await expect(settings(page).locator('form[id$="-passkey"]').getByRole('button', { name: 'Verify and add passkey', exact: true })).toBeDisabled();
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

Then('the password replacement pane validates matching values and preserves recovery access', async function () {
  const page = this.page, vault = settings(page), replacement = 'browser-CHANGED-password-9182';
  const before = await storage(page, 'read');
  const previousRecovery = before.snapshot.envelopes.find(envelope => envelope.kind === 'recovery');
  await vault.getByRole('button', { name: 'Replace password', exact: true }).click();
  const form = vault.locator('form[id$="-password"]');
  await expect(form.getByRole('combobox')).toHaveCount(0);
  await form.getByLabel('Password, or recovery key', { exact: true }).fill(canaries[0]);
  await form.getByLabel('New password', { exact: true }).fill(replacement);
  await form.getByLabel('Confirm new password', { exact: true }).fill('does-not-match');
  await form.getByRole('button', { name: 'Verify and replace password', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('matching passwords');
  assert.deepEqual(await storage(page, 'read'), before);
  await form.getByLabel('Password, or recovery key', { exact: true }).fill(this.uiRecovery);
  await form.getByLabel('New password', { exact: true }).fill(replacement);
  await form.getByLabel('Confirm new password', { exact: true }).fill(replacement);
  await form.getByRole('button', { name: 'Verify and replace password', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(vault.getByRole('status')).toHaveText('Password replaced.');
  const saved = await storage(page, 'read');
  assert.deepEqual(saved.snapshot.envelopes.find(envelope => envelope.kind === 'recovery'), previousRecovery);
  assert.equal(saved.snapshot.envelopes.filter(envelope => envelope.kind === 'password').length, 1);
  assert.ok(!JSON.stringify(saved).includes(replacement));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await vault.getByLabel('Unlock password, or recovery key', { exact: true }).fill(canaries[0]);
  await vault.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await expect(vault.getByRole('alert')).toBeVisible();
  await expect(vault.getByRole('heading', { name: 'Confirm management actions', exact: true })).toHaveCount(0);
  await unlockUI(page, replacement);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await unlockUI(page, this.uiRecovery);
  await expect(vault.locator('li').getByText(canaries[3], { exact: true })).toBeVisible();
});


Then('a public operation resolves a vault variable only after upgrading its legacy schema policy', async function () {
  const result = await policy(this.page, 'publicVariable', true);
  assert.equal(result.before, 'PERMISSION');
  assert.equal(result.value.response.status, 200);
  noCanaries(result);
  const sent = await observations(this);
  assert.equal(sent.length, 2, 'only the baseline request and upgraded variable request may dispatch');
  assert.equal(sent[1].headers['x-vault-variable'], canaries[1]);
  assert.equal(sent[1].headers.authorization, undefined);
});


Then('a legacy vault publishes only key names after unlocking without changing its encrypted snapshot', async function () {
  const result = await this.page.evaluate(async fixture => {
    const { VaultSession, createVaultStorage, synthetic } = await import(fixture);
    const storage = createVaultStorage(), before = await storage.read();
    const legacy = await storage.replace(before, before.snapshot);
    const session = new VaultSession(storage);
    const unavailable = await session.keys();
    const proof = { methodId: legacy.snapshot.envelopes.find(item => item.kind === 'password').id, secret: synthetic.password };
    await session.unlock(proof); session.lock();
    const indexed = await storage.read(), keys = await session.keys();
    let valueError;
    try { await session.copyCredential(keys.entries[0].id); } catch (error) { valueError = error.code; }
    await storage.lock();
    let conflict;
    try { await storage.indexKeys(indexed, keys.entries); } catch (error) { conflict = error.code; }
    return { unavailable, keys, valueError, conflict, sameSnapshot: JSON.stringify(legacy.snapshot) === JSON.stringify(indexed.snapshot),
      sameCounters: legacy.revision === indexed.revision && legacy.lockEpoch === indexed.lockEpoch };
  }, fixture);
  assert.deepEqual(result.unavailable, { entries: [], needsUnlock: true });
  assert.equal(result.keys.needsUnlock, false); assert.equal(result.keys.entries.length, 2);
  assert.equal(result.valueError, 'LOCKED'); assert.equal(result.conflict, 'CONFLICT');
  assert.equal(result.sameSnapshot, true); assert.equal(result.sameCounters, true); noCanaries(result);
});

Then('factory schema policy accepts only the matching packaged digest', async function () {
  assert.equal(await policy(this.page, 'factoryPolicy'), 'PERMISSION');
});

async function privateHeaderSelection(kind, provider) {
  const page = this.page, isEleven = provider === 'ElevenLabs';
  const header = isEleven ? 'xi-api-key' : 'x-api-key', keyScheme = `${provider}ApiKey`;
  const edgeId = `legacy-${provider.toLowerCase()}-key-edge`;
  this.vaultRun = randomUUID();
  const path = `/vault-api/${this.vaultRun}/ok`, name = `${provider} private request`;
  const document = { openapi: '3.1.0', info: { title: `${provider} auth fixture`, version: '1' }, servers: [{ url: this.baseURL }],
    components: { securitySchemes: { [keyScheme]: { type: 'apiKey', in: 'header', name: header }, AnthropicBearer: { type: 'http', scheme: 'bearer' } } },
    security: isEleven ? [{ [keyScheme]: [] }] : [{ [keyScheme]: [] }, { AnthropicBearer: [] }], paths: { [path]: { get: { operationId: 'anthropic-auth', summary: name,
      parameters: [...(isEleven ? [] : [{ name: 'anthropic-version', in: 'header', required: true, schema: { type: 'string' } }]),
        { name: header, in: 'header', required: false, schema: { type: 'string', ...(isEleven ? { nullable: true } : {}) } }],
      responses: { 200: { description: 'Synthetic result', content: { 'application/json': { schema: { type: 'object' } } } } },
    } } } };
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'anthropic-auth.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByRole('switch', { name: `Enable ${provider} auth fixture`, exact: true })).toHaveAttribute('aria-checked', 'true');
  await setMode(page, 'workflow'); await chooseCatalogOperation(page, name);
  const selection = kind === 'connected API key' ? keyScheme : 'AnthropicBearer';
  let id;
  if (kind === 'connected API key') {
    await page.getByRole('dialog', { name: /^Run workflow:/ }).getByRole('button', { name: 'Quit', exact: true }).click();
    const key = (await storage(page, 'read')).keys.find(key => key.label === canaries[3]); id = key.id;
    const current = (await repository(page, 'list')).find(document => document.nodes.some(node => node.data?.name === name));
    const state = await repository(page, 'load', current.id), updated = state.document;
    updated.version = 3; // Vault nodes use the existing version-3 workflow format.
    const panel = updated.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs'
      && node.data.fields.some(field => field.label.toLowerCase() === header));
    const variable = createUtilityNode('vault', { x: 0, y: 0 }, 'legacy-anthropic-vault'); variable.data.credentialId = id;
    updated.nodes.push(variable); updated.edges.push({ id: edgeId, kind: 'mapping', source: variable.id, sourceHandle: 'value',
      target: panel.id, targetHandle: panel.data.fields.find(field => field.label.toLowerCase() === header).id });
    await repository(page, 'save', updated, state.revision, 'Connect existing private header');
    await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
    await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Authentication alternative', exact: true })).toContainText(selection);
  } else {
    await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
    await page.getByRole('option', { name: selection, exact: true }).click();
  }
  const credential = page.getByRole('combobox', { name: `Credential for ${selection}`, exact: true });
  await expect(credential).toBeVisible();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  if (await unlock.isVisible()) {
    await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(unlock).toHaveCount(0);
  }
  if (kind !== 'connected API key') { await credential.click(); await page.getByRole('option', { name: canaries[3], exact: true }).click(); }
  await expect(credential).toContainText(canaries[3]);
  const savedDocument = async () => (await repository(page, 'list')).find(document => document.nodes.some(node => node.data?.name === name));
  const savedBinding = async () => (await savedDocument()).nodes.find(node => node.data?.name === name).data.credentialBinding;
  await expect.poll(async () => (await savedBinding())?.credentials[selection] ?? '').not.toBe('');
  const saved = await savedBinding();
  assert.match(saved.credentials[selection], /^[a-f0-9-]{36}$/);
  if (id) assert.equal(saved.credentials[selection], id);
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/${provider.toLowerCase()}-selection.png` });
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(credential).toContainText(canaries[3]); assert.deepEqual(await savedBinding(), saved);
  if (id) assert.ok((await savedDocument()).edges.some(edge => edge.id === edgeId));
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click(); await expect(unlock).toHaveCount(0);
  if (!isEleven) await page.getByLabel('anthropic-version', { exact: true }).fill('2023-06-01');
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  const seen = await observations(this); assert.equal(seen.length, 1);
  if (!isEleven) assert.equal(seen[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(seen[0].headers[kind === 'connected API key' ? header : 'authorization'], kind === 'connected API key' ? canaries[1] : `Bearer ${canaries[1]}`);
  assert.equal(seen[0].headers[kind === 'connected API key' ? 'authorization' : header], undefined);
  assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers.referer, undefined);
  noCanaries(await page.locator('body').innerText());
  assert.deepEqual(await invoke(page, 'persistedCanaries', privateCanaries), []);
}

Then('the Anthropic {string} selection preserves private headers and saved references across reload', { timeout: 90_000 }, async function (kind) {
  await privateHeaderSelection.call(this, kind, 'Anthropic');
});
Then('the ElevenLabs private key connection survives reload without exposing credentials', { timeout: 90_000 }, async function () {
  await privateHeaderSelection.call(this, 'connected API key', 'ElevenLabs');
});

Then('S3 transfers at {int} pixels use private signatures raw bytes and verified binary downloads', { timeout: 90_000 }, async function (width) {
  const page=this.page,endpoint='https://s3.us-east-1.amazonaws.com',bucket='operations-test-bucket',key='folder//雪 +?%2F/data.bin';
  const bytes=Buffer.from([0,255,13,10,239,187,191,65]),calls=[];let stored;
  await page.setViewportSize({width,height:900});await invoke(page,'seedAWS',this.baseURL,randomUUID(),awsSyntheticValues);
  await this.context.route(endpoint+'/**',async route=>{
    const request=route.request(),cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Expose-Headers':'ETag, x-amz-checksum-sha256, x-amz-checksum-type, Content-Disposition'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    const body=request.postDataBuffer()??undefined,signature=verifyAwsSignature(request.url(),{method:request.method(),headers:request.headers(),body},awsSyntheticValues,'s3');calls.push(signature);
    assert.equal(decodeURIComponent(new URL(request.url()).pathname),'/'+bucket+'/'+key);assert.equal(request.headers().cookie,undefined);assert.equal(request.headers().referer,undefined);
    if(request.method()==='PUT'){assert.deepEqual(body,bytes);assert.equal(request.headers()['content-type'],'application/octet-stream');assert.equal(request.headers()['x-amz-meta-note'],'exact file');stored=body;
      return route.fulfill({status:200,headers:{...cors,...s3FixtureChecksums(body),'Content-Type':'text/plain'},body:''});}
    assert.equal(request.method(),'GET');assert.equal(request.headers()['x-amz-checksum-mode'],'ENABLED');assert.ok(stored);
    return route.fulfill({status:200,headers:{...cors,...s3FixtureChecksums(stored),'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="s3-object.bin"'},body:stored});
  });
  const names={put:'S3 upload fixture',get:'S3 download fixture'};
  const document={openapi:'3.0.3',info:{title:'S3 files fixture',version:'1'},servers:[{url:endpoint}],security:[{hmac:[]}],components:{securitySchemes:{hmac:{type:'apiKey',in:'header',name:'Authorization','x-amazon-apigateway-authtype':'awsS3'}}},
    paths:{'/{Bucket}/{Key}':Object.fromEntries(['put','get'].map(method=>[method,{operationId:method+'Object',summary:names[method],'x-operations-s3-files':method==='put'?'put-object':'get-object','x-operations-aws-signing':'s3-object',
      ...(method==='put'?{requestBody:{required:true,content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}}}:{}),responses:{200:{description:'Object result',content:{[method==='put'?'text/plain':'application/octet-stream']:{schema:{type:'string',...(method==='get'?{format:'binary'}:{})}}}}}}]))}};
  await setMode(page,'settings');const schemas=page.locator('summary[aria-label="Schemas"]');if(await schemas.getAttribute('aria-expanded')!=='true')await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({name:'s3-files.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await expect(page.getByRole('switch',{name:'Enable S3 files fixture',exact:true})).toHaveAttribute('aria-checked','true');await chooseCatalogOperation(page,names.put);
  await page.getByRole('combobox',{name:'Authentication alternative',exact:true}).click();await page.getByRole('option',{name:'hmac',exact:true}).click();
  const unlock=page.getByLabel('Unlock the vault password',{exact:true});await unlock.fill(canaries[0]);await page.getByRole('button',{name:'Unlock',exact:true}).click();
  for(const [part,label] of [['accessKeyId','Access key ID'],['secretAccessKey','Secret access key'],['sessionToken','Session token']]){
    await page.getByRole('combobox',{name:label+' for hmac',exact:true}).click();await page.getByRole('option',{name:'AWS '+part,exact:true}).click();}
  await page.getByText('Save as connection',{exact:true}).click();await page.getByLabel('Connection name',{exact:true}).fill('S3 connection');await page.getByLabel('Account label',{exact:true}).fill('S3 sandbox');await page.getByRole('button',{name:'Save connection',exact:true}).click();
  const connection=page.getByRole('combobox',{name:'Saved HTTP connection',exact:true});await expect(connection).toContainText('S3 connection · S3 sandbox');
  await page.getByRole('textbox',{name:'Bucket',exact:true}).fill(bucket);await page.getByRole('textbox',{name:'Key',exact:true}).fill(key);
  await page.getByRole('checkbox',{name:'Do not send Metadata',exact:true}).uncheck();await page.getByRole('textbox',{name:'Metadata',exact:true}).fill('{"note":"exact file"}');
  await page.getByLabel('Object data',{exact:true}).setInputFiles({name:'source.bin',mimeType:'application/octet-stream',buffer:bytes});
  await page.getByRole('button',{name:/^(Start workflow|Run operation|Retry operation)$/}).click();await expect(page.getByRole('status').filter({hasText:'Operation completed.'})).toBeVisible();
  assert.equal(calls.length,1);await page.reload();await page.locator('#startup-status').waitFor({state:'detached'});await chooseCatalogOperation(page,names.get);
  await page.getByRole('combobox',{name:'Authentication alternative',exact:true}).click();await page.getByRole('option',{name:'hmac',exact:true}).click();
  await unlock.fill(canaries[0]);await page.getByRole('button',{name:'Unlock',exact:true}).click();await connection.click();await page.getByRole('option',{name:'S3 connection · S3 sandbox',exact:true}).click();
  await page.getByRole('textbox',{name:'Bucket',exact:true}).fill(bucket);await page.getByRole('textbox',{name:'Key',exact:true}).fill(key);
  await page.getByRole('button',{name:/^(Start workflow|Run operation|Retry operation)$/}).click();await expect(page.getByRole('status').filter({hasText:'Operation completed.'})).toBeVisible();
  const body=page.locator('[aria-label="Response body"]').last();await expect(body).toContainText('s3-object.bin');const downloading=page.waitForEvent('download');await body.getByRole('button',{name:'Download file',exact:true}).click();
  const chunks=[];for await(const chunk of await (await downloading).createReadStream())chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(calls.length,2);
  const secrets=[...Object.values(awsSyntheticValues),...calls.flatMap(call=>[call.authorization,call.signature])];for(const value of [await page.locator('body').innerText(),await repository(page,'list'),await storage(page,'read')])for(const secret of secrets)assert.ok(!JSON.stringify(value).includes(secret));
  assert.deepEqual(await invoke(page,'persistedCanaries',[...privateCanaries,...secrets]),[]);await mkdir(this.artifactDirectory,{recursive:true});await page.screenshot({path:`${this.artifactDirectory}/s3-files-${width}.png`});
});

Then('native S3 CORS preflight rejects missing permissions and hidden integrity headers cannot confirm a write', {timeout:60_000}, async function(){
  const page=this.page,id=randomUUID(),bytes=Uint8Array.from([0,255,13,10,65]);await this.context.unrouteAll({behavior:'wait'});
  const cross=this.baseURL.replace('127.0.0.1','localhost')+'/s3-cors/'+id;
  const put=await signAwsRequest('PUT',s3CorsLogicalUrl,new Headers({'Content-Type':'application/octet-stream','x-amz-meta-note':'CORS fixture','x-amz-checksum-sha256':s3FixtureChecksums(bytes)['x-amz-checksum-sha256']}),bytes,awsSyntheticValues,{service:'s3',region:'us-east-1'});
  const request={method:'PUT',headers:Object.fromEntries(put.headers),bytes:Array.from(bytes)};
  const allowed=await invoke(page,'probeS3Cors',cross+'/allow',request);assert.equal(allowed.status,200);assert.equal(allowed.verified,true);assert.ok(allowed.checksum);assert.ok(allowed.etag);
  const get=await signAwsRequest('GET',s3CorsLogicalUrl,new Headers({'x-amz-checksum-mode':'ENABLED'}),undefined,awsSyntheticValues,{service:'s3',region:'us-east-1'});
  const result=await invoke(page,'probeS3Cors',cross+'/allow',{method:'GET',headers:Object.fromEntries(get.headers)});assert.equal(result.verified,true);assert.deepEqual(result.bytes,Array.from(bytes));
  for(const mode of ['deny-header','deny-method']){const refused=await invoke(page,'probeS3Cors',cross+'/'+mode,request);assert.equal(refused.error,'TypeError');}
  const hidden=await invoke(page,'probeS3Cors',cross+'/hidden',request);assert.equal(hidden.status,200);assert.equal(hidden.verified,false);assert.equal(hidden.error,'S3_INTEGRITY');assert.equal(hidden.etag,null);assert.equal(hidden.checksum,null);
  const events=await (await this.context.request.get(this.baseURL+'/s3-cors/'+id+'/observations')).json();assert.ok(events.some(event=>event.method==='OPTIONS'&&event.requestedHeaders.includes('authorization')&&event.requestedHeaders.includes('x-amz-security-token')&&!event.sentAuthorization));
  assert.equal(events.filter(event=>['deny-header','deny-method'].includes(event.mode)&&event.method!=='OPTIONS').length,0);assert.equal(events.filter(event=>event.mode==='hidden'&&event.method==='PUT'&&event.verified).length,1);assert.ok(!events.some(event=>event.failed));
  this.diagnostics=this.diagnostics.filter(item=>!(item.type==='console-error'&&(/CORS|Failed to load resource|net::ERR_FAILED/.test(item.message))&&(item.message.includes('/s3-cors/'+id)||item.location?.url?.startsWith(cross))));
});

Then('AWS wire workflows at {int} pixels sign real requests and reuse encrypted connections', {timeout:60_000}, async function(width){
  const page=this.page,calls=[],names={batch:'AWS wire BatchGetItem fixture',tables:'AWS wire ListTables fixture',identity:'AWS wire STS identity fixture'};
  await page.setViewportSize({width,height:900});await invoke(page,'seedAWS',this.baseURL,randomUUID(),awsSyntheticValues);
  const items={Orders:{Keys:[{id:{S:'雪 +/%?&='},revision:{N:'900719925474099312345'}}]}};
  const identity='<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Account>001234567890</Account><Arn>arn:aws:iam::001234567890:user/Alice</Arn><UserId>000123:Alice</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>00001234</RequestId></ResponseMetadata></GetCallerIdentityResponse>';
  for(const service of ['dynamodb','sts'])await this.context.route('https://'+service+'.us-east-1.amazonaws.com/**',async route=>{
    const request=route.request(),cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    const bytes=request.postDataBuffer(),signed=verifyAwsSignature(request.url(),{method:request.method(),headers:request.headers(),body:bytes},awsSyntheticValues,service);
    const url=new URL(request.url());assert.equal(url.pathname,'/');assert.equal(url.hash,'');assert.equal(url.search,'');assert.equal(request.method(),'POST');calls.push({...signed,service});
    if(service==='sts'){assert.equal(bytes.toString(),'Action=GetCallerIdentity&Version=2011-06-15');assert.equal(request.headers()['content-type'],'application/x-www-form-urlencoded');return route.fulfill({status:200,headers:{...cors,'Content-Type':'text/xml'},body:identity});}
    assert.equal(request.headers()['content-type'],'application/x-amz-json-1.0');const body=JSON.parse(bytes.toString()),target=request.headers()['x-amz-target'];
    if(target==='DynamoDB_20120810.BatchGetItem'){assert.deepEqual(body,{RequestItems:items});return route.fulfill({status:200,headers:{...cors,'Content-Type':'application/x-amz-json-1.0'},body:JSON.stringify({Responses:{Orders:[{revision:{N:'900719925474099312345'}}]},UnprocessedKeys:items})});}
    assert.equal(target,'DynamoDB_20120810.ListTables');assert.deepEqual(body,{});return route.fulfill({status:200,headers:{...cors,'Content-Type':'application/x-amz-json-1.0'},body:'{"TableNames":["Orders"]}'});
  });
  const source=(operationId,name,profile,signing,service)=>({operationId,summary:name,'x-operations-aws-wire':profile,'x-operations-aws-signing':signing,
    servers:[{url:'https://'+service+'.us-east-1.amazonaws.com'}],responses:{200:{description:'Decoded result',content:{'application/json':{schema:{type:'object'}}}}}});
  const document={openapi:'3.0.3',info:{title:'AWS wire fixture',version:'1'},servers:[{url:'https://dynamodb.us-east-1.amazonaws.com'}],security:[{hmac:[]}],
    components:{securitySchemes:{hmac:{type:'apiKey',in:'header',name:'Authorization','x-amazon-apigateway-authtype':'awsSigv4'}}},paths:{
      '/#X-Amz-Target=DynamoDB_20120810.BatchGetItem':{post:source('BatchGetItem',names.batch,'dynamodb-batch-get-item','dynamodb-json-1.0','dynamodb')},
      '/#X-Amz-Target=DynamoDB_20120810.ListTables':{post:source('ListTables',names.tables,'dynamodb-list-tables','dynamodb-json-1.0','dynamodb')},
      '/#Action=GetCallerIdentity':{post:source('POST_GetCallerIdentity',names.identity,'sts-get-caller-identity','sts-query-2011-06-15','sts')}}};
  await setMode(page,'settings');const schemas=page.locator('summary[aria-label="Schemas"]');if(await schemas.getAttribute('aria-expanded')!=='true')await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({name:'aws-wire.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await expect(page.getByRole('switch',{name:'Enable AWS wire fixture',exact:true})).toHaveAttribute('aria-checked','true');
  const authentication=async()=>{await page.getByRole('combobox',{name:'Authentication alternative',exact:true}).click();await page.getByRole('option',{name:'hmac',exact:true}).click();};
  const unlock=async()=>{await page.getByLabel('Unlock the vault password',{exact:true}).fill(canaries[0]);await page.getByRole('button',{name:'Unlock',exact:true}).click();};
  const save=async name=>{for(const [part,label] of [['accessKeyId','Access key ID'],['secretAccessKey','Secret access key'],['sessionToken','Session token']]){
    await page.getByRole('combobox',{name:label+' for hmac',exact:true}).click();await page.getByRole('option',{name:'AWS '+part,exact:true}).click();}
    await page.getByText('Save as connection',{exact:true}).click();await page.getByLabel('Connection name',{exact:true}).fill(name);await page.getByLabel('Account label',{exact:true}).fill('AWS sandbox');await page.getByRole('button',{name:'Save connection',exact:true}).click();};
  const run=async()=>{await page.getByRole('button',{name:/^(Start workflow|Run operation|Retry operation)$/}).click();await expect(page.getByRole('status').filter({hasText:'Operation completed.'})).toBeVisible();};
  await chooseCatalogOperation(page,names.batch);await authentication();await unlock();await save('DynamoDB wire');
  await page.getByRole('textbox',{name:'RequestItems',exact:true}).fill(JSON.stringify(items));await run();
  await expect(page.locator('[aria-label="Response body"]').last()).toContainText('900719925474099312345');assert.equal(calls.length,1);
  await page.reload();await page.locator('#startup-status').waitFor({state:'detached'});await chooseCatalogOperation(page,names.tables);await authentication();await unlock();
  await page.getByRole('combobox',{name:'Saved HTTP connection',exact:true}).click();await page.getByRole('option',{name:'DynamoDB wire · AWS sandbox',exact:true}).click();await run();
  await expect(page.locator('[aria-label="Response body"]').last()).toContainText('Orders');assert.equal(calls.length,2);
  await chooseCatalogOperation(page,names.identity);await authentication();await save('STS wire');await run();
  await expect(page.locator('[aria-label="Response body"]').last()).toContainText('001234567890');await expect(page.locator('[aria-label="Response body"]').last()).toContainText('00001234');assert.equal(calls.length,3);
  const secrets=[...Object.values(awsSyntheticValues),...calls.flatMap(call=>[call.authorization,call.signature])];for(const value of [await page.locator('body').innerText(),await repository(page,'list'),await storage(page,'read')])for(const secret of secrets)assert.ok(!JSON.stringify(value).includes(secret));
  assert.deepEqual(await invoke(page,'persistedCanaries',[...privateCanaries,...secrets]),[]);await mkdir(this.artifactDirectory,{recursive:true});await page.screenshot({path:`${this.artifactDirectory}/aws-wire-${width}.png`});
});

Then('an AWS connection at {int} pixels signs a regional Lambda request after encrypted reload', { timeout: 60_000 }, async function (width) {
  const page = this.page, seen = [], endpoint = 'https://lambda.us-east-1.amazonaws.com';
  await page.setViewportSize({ width, height: 900 }); await invoke(page, 'seedAWS', this.baseURL, randomUUID(), awsSyntheticValues);
  await this.context.route(endpoint+'/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    assert.equal(request.method(), 'GET'); assert.equal(request.postData(), null);
    const signed = verifyAwsSignature(request.url(), { method: request.method(), headers: request.headers() });
    assert.equal(request.headers().cookie, undefined); assert.equal(request.headers().referer, undefined);
    const url = new URL(request.url()); assert.equal(url.pathname, '/2015-03-31/functions/');
    assert.equal(url.searchParams.get('Marker'), 'next +/?=%雪'); assert.equal(url.searchParams.get('MaxItems'), '2');
    seen.push(signed);
    return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"Functions":[]}' });
  });
  const name = 'AWS Lambda signing fixture';
  const document = { openapi: '3.0.3', info: { title: name, version: '1' }, servers: [{ url: endpoint }], security: [{ hmac: [] }],
    components: { securitySchemes: { hmac: { type: 'apiKey', in: 'header', name: 'Authorization',
      'x-amazon-apigateway-authtype': 'awsSigv4', 'x-operations-aws-sigv4': 'lambda-list-functions' } } },
    paths: { '/2015-03-31/functions/': { get: { operationId: 'ListFunctions', summary: name,
      parameters: [{ name: 'Marker', in: 'query', required: true, schema: { type: 'string' } }, { name: 'MaxItems', in: 'query', required: true, schema: { type: 'integer' } }],
      responses: { 200: { description: 'Functions', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
  await setMode(page, 'settings'); const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'aws-lambda.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable '+name, exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'hmac', exact: true }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  for (const [part, label] of [['accessKeyId', 'Access key ID'], ['secretAccessKey', 'Secret access key'], ['sessionToken', 'Session token']]) {
    await page.getByRole('combobox', { name: label+' for hmac', exact: true }).click();
    await page.getByRole('option', { name: 'AWS '+part, exact: true }).click();
  }
  await page.getByText('Save as connection', { exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('AWS connection');
  await page.getByLabel('Account label', { exact: true }).fill('AWS sandbox');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  const connection = page.getByRole('combobox', { name: 'Saved HTTP connection', exact: true });
  await expect(connection).toContainText('AWS connection · AWS sandbox');
  const binding = async () => (await repository(page, 'list')).flatMap(document => document.nodes).find(node => node.data?.name === name)?.data.credentialBinding;
  await expect.poll(async () => (await binding())?.connection?.revision).toBe(1); assert.deepEqual((await binding()).credentials, {}); assert.equal(seen.length, 0);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(connection).toContainText('AWS connection · AWS sandbox'); await expect(connection).toBeEnabled();
  // Run-form values are transient; saved connection references survive reload.
  await page.getByRole('textbox', { name: 'Marker', exact: true }).fill('next +/?=%雪');
  const maxItems = page.getByRole('slider', { name: 'MaxItems', exact: true });
  await maxItems.press('ArrowRight'); await expect(maxItems).toHaveAttribute('aria-valuenow', '1');
  await maxItems.press('ArrowRight'); await expect(maxItems).toHaveAttribute('aria-valuenow', '2');
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); assert.equal(seen.length, 1);
  const privateValues = [...Object.values(awsSyntheticValues), seen[0].authorization, seen[0].signature];
  for (const value of [await page.locator('body').innerText(), await repository(page, 'list'), await storage(page, 'read')])
    for (const secret of privateValues) assert.ok(!JSON.stringify(value).includes(secret));
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, ...privateValues]), []);
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/aws-sigv4-${width}.png` });
});

Then('an X OAuth1 connection at {int} pixels signs privately after selecting four stored credentials', { timeout: 60_000 }, async function (width) {
  const page = this.page, seen = [], parts = ['consumerKey', 'consumerSecret', 'accessToken', 'tokenSecret'];
  const secrets = Object.fromEntries(parts.map(part => [part, 'browser_X_'+part+'_canary_5729']));
  const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%'+c.charCodeAt(0).toString(16).toUpperCase());
  await page.setViewportSize({ width, height: 900 });
  await invoke(page, 'seedOAuth1', this.baseURL, randomUUID());
  await this.context.route('https://api.x.com/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const authorization = request.headers().authorization;
    assert.ok(authorization?.startsWith('OAuth '));
    const oauth = Object.fromEntries(authorization.slice(6).split(', ').map(part => {
      const [key, value] = part.split('='); return [key, decodeURIComponent(value.slice(1, -1))];
    }));
    assert.equal(oauth.oauth_consumer_key, secrets.consumerKey); assert.equal(oauth.oauth_token, secrets.accessToken);
    assert.match(oauth.oauth_nonce, /^[a-f0-9]{64}$/); assert.ok(Math.abs(Number(oauth.oauth_timestamp)-Date.now()/1000) < 10);
    const signature = oauth.oauth_signature; delete oauth.oauth_signature;
    const url = new URL(request.url());
    const normalized = [...url.searchParams, ...Object.entries(oauth)].map(([name, value]) => [encode(name), encode(value)])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(pair => pair.join('=')).join('&');
    assert.equal(signature, createHmac('sha1', encode(secrets.consumerSecret)+'&'+encode(secrets.tokenSecret))
      .update([request.method(), url.origin+url.pathname, normalized].map(encode).join('&')).digest('base64'));
    seen.push({ url: request.url(), headers: request.headers() });
    return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"accepted":true}' });
  });
  const name = 'X OAuth1 fixture';
  const document = { openapi: '3.0.0', info: { title: name, version: '1' }, servers: [{ url: 'https://api.x.com' }],
    components: { securitySchemes: { OAuth2: { type: 'http', scheme: 'bearer' }, UserToken: { type: 'http', scheme: 'OAuth', 'x-operations-oauth1': 'x-hmac-sha1' } } },
    paths: { '/2/users/me': { get: { operationId: 'readXUser', summary: name, security: [{ OAuth2: [] }, { UserToken: [] }],
      responses: { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
  await setMode(page, 'settings'); const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'x-oauth1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable '+name, exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'UserToken', exact: true }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const labels = ['Consumer key', 'Consumer secret', 'Access token', 'Access token secret'];
  for (let i = 0; i < parts.length; i++) {
    await page.getByRole('combobox', { name: labels[i]+' for UserToken', exact: true }).click();
    await page.getByRole('option', { name: 'X fixture '+parts[i], exact: true }).click();
  }
  await page.getByText('Save as connection', { exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('X connection');
  await page.getByLabel('Account label', { exact: true }).fill('Synthetic X account');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  const connection = page.getByRole('combobox', { name: 'Saved HTTP connection', exact: true });
  await expect(connection).toContainText('X connection · Synthetic X account');
  const binding = async () => (await repository(page, 'list')).flatMap(document => document.nodes).find(node => node.data?.name === name)?.data.credentialBinding;
  await expect.poll(async () => (await binding())?.connection?.revision).toBe(1);
  assert.deepEqual((await binding()).credentials, {}); assert.equal(seen.length, 0);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(connection).toContainText('X connection · Synthetic X account'); await expect(connection).toBeEnabled();
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  assert.equal(seen.length, 1); assert.equal(seen[0].url, 'https://api.x.com/2/users/me');
  assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers.referer, undefined);
  for (const value of [await page.locator('body').innerText(), await repository(page, 'list'), await storage(page, 'read')])
    for (const secret of Object.values(secrets)) assert.ok(!JSON.stringify(value).includes(secret));
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, ...Object.values(secrets), ...Object.values(secrets).map(encode)]), []);
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/x-oauth1-${width}.png` });
});

Then('Jira companion sign-in at {int} pixels uses native CORS and keeps its provider tokens outside the application', {timeout:90_000}, async function(width){
  const page=this.page,run=randomUUID();await page.setViewportSize({width,height:900});
  await this.context.unrouteAll({behavior:'wait'});
  const endpoint=this.baseURL+'/jira-companion-fixture/'+run;
  const created=await this.context.request.post(endpoint+'/create');assert.equal(created.status(),200);const host=await created.json();
  let consents=0;
  await this.context.route('https://auth.atlassian.com/authorize**',async route=>{
    const authorization=new URL(route.request().url());consents++;assert.equal(authorization.searchParams.get('audience'),'api.atlassian.com');assert.equal(authorization.searchParams.get('scope'),'read:jira-user offline_access');
    assert.equal(authorization.searchParams.has('client_secret'),false);assert.equal(authorization.searchParams.get('redirect_uri'),host.publicOrigin+'/oauth/jira/callback');
    const callback=new URL(host.publicOrigin+'/oauth/jira/callback');callback.searchParams.set('state',authorization.searchParams.get('state'));
    callback.searchParams.set(consents===1?'error':'code',consents===1?'access_denied':jiraCanaries.code);
    await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic Jira consent</title><script>location.replace('+JSON.stringify(callback.href)+')</script>'});
  });
  try{
    await invoke(page,'seedJira',this.baseURL,run,jiraCanaries.accessKey);
    const name='Jira companion current user fixture',document={openapi:'3.0.3',info:{title:name,version:'1'},servers:[{url:host.siteUrl}],security:[{OAuth2:[]}],
      components:{securitySchemes:{OAuth2:{type:'http',scheme:'bearer'}}},paths:{'/rest/api/3/myself':{get:{operationId:'getCurrentUser',summary:name,
        parameters:[{name:'expand',in:'query',schema:{type:'string'}}],responses:{200:{description:'Current user',content:{'application/json':{schema:{type:'object'}}}}}}}}};
    await setMode(page,'settings');const schemas=page.locator('summary[aria-label="Schemas"]');if(await schemas.getAttribute('aria-expanded')!=='true')await schemas.click();
    await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({name:'jira-companion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
    await expect(page.getByRole('switch',{name:'Enable '+name,exact:true})).toHaveAttribute('aria-checked','true');await chooseCatalogOperation(page,name);
    await page.getByRole('combobox',{name:'Authentication alternative',exact:true}).click();await page.getByRole('option',{name:'OAuth2',exact:true}).click();
    const unlock=page.getByLabel('Unlock the vault password',{exact:true});await unlock.fill(canaries[0]);await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByText('Connect Jira account',{exact:true}).click();await page.getByLabel('Jira companion URL',{exact:true}).fill(host.publicOrigin);
    await page.getByRole('combobox',{name:'Jira companion access key',exact:true}).click();await page.getByRole('option',{name:'Jira companion access key',exact:true}).click();
    await page.getByLabel('Jira connection name',{exact:true}).fill('Jira connection');
    await page.getByRole('button',{name:'Connect Jira',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Jira sign-in was not completed.'})).toBeVisible();
    await page.getByRole('button',{name:'Connect Jira',exact:true}).click();await expect(page.getByRole('combobox',{name:'Jira site',exact:true})).toContainText('Operations Jira');
    // Chromium routing can hide preflight. Consent is complete; require native
    // browser networking for the private claim, saved capability and Origin denial.
    await this.context.unrouteAll({behavior:'wait'});
    await page.getByRole('button',{name:'Connect selected Jira site',exact:true}).click();
    const connection=page.getByRole('combobox',{name:'Saved HTTP connection',exact:true});await expect(connection).toContainText('Jira connection · Jira '+host.accountId);
    const binding=async()=>(await repository(page,'list')).flatMap(workflow=>workflow.nodes).find(node=>node.data?.name===name)?.data.credentialBinding;
    await expect.poll(async()=>(await binding())?.connection?.revision).toBe(1);assert.deepEqual((await binding()).credentials,{});
    let seen=await (await this.context.request.get(endpoint+'/observations')).json();assert.equal(seen.providers.filter(item=>item.url==='https://auth.atlassian.com/oauth/token').length,1);
    await page.reload();await page.locator('#startup-status').waitFor({state:'detached'});await setMode(page,'workflow');await page.getByRole('button',{name:'Run workflow',exact:true}).click();
    await unlock.fill(canaries[0]);await page.getByRole('button',{name:'Unlock',exact:true}).click();await expect(connection).toContainText('Jira connection · Jira '+host.accountId);
    await this.context.request.post(endpoint+'/expire');await page.getByRole('button',{name:/^(Start workflow|Run operation|Retry operation)$/}).click();
    await expect(page.getByRole('status').filter({hasText:'Operation completed.'})).toBeVisible();await expect(page.locator('[aria-label="Response body"]').last()).toContainText(host.accountId);
    seen=await (await this.context.request.get(endpoint+'/observations')).json();assert.equal(seen.providers.filter(item=>item.grant==='refresh_token').length,1);
    assert.ok(seen.providers.filter(item=>item.url.includes('/rest/api/3/myself')).every(item=>item.url.includes('/ex/jira/'+host.cloudId+'/')));
    assert.ok(seen.events.some(item=>item.method==='OPTIONS'&&item.requestedHeaders.includes('authorization')&&!item.sentAuthorization));assert.ok(seen.events.some(item=>item.sentConnection));assert.ok(!seen.events.some(item=>item.sentCookie));
    const foreign=await this.context.newPage();await foreign.goto(this.baseURL.replace('127.0.0.1','localhost')+'/vault-fixture.html');
    const denied=await foreign.evaluate(async({origin,key})=>{try{await fetch(origin+'/v1/jira/config',{headers:{Authorization:'Bearer '+key},credentials:'omit'});return 'allowed';}catch(error){return error.name;}},{origin:host.publicOrigin,key:jiraCanaries.accessKey});assert.equal(denied,'TypeError');await foreign.close();
    const secrets=[...privateCanaries,jiraCanaries.accessKey,jiraCanaries.clientSecret,jiraCanaries.code,jiraCanaries.accessPrefix,jiraCanaries.refreshPrefix];
    for(const value of [await page.locator('body').innerText(),await repository(page,'list'),await storage(page,'read')])for(const secret of secrets)assert.ok(!JSON.stringify(value).includes(secret));
    assert.deepEqual(await invoke(page,'persistedCanaries',secrets),[]);await mkdir(this.artifactDirectory,{recursive:true});await page.screenshot({path:this.artifactDirectory+'/jira-companion-'+width+'.png'});
  }finally{await this.context.request.delete(endpoint+'/close');}
});

Then('GitLab public sign-in at {int} pixels uses a private PKCE exchange and saved resource connection', { timeout: 75_000 }, async function (width) {
  const page = this.page, clientId = 'a'.repeat(64), code = 'GL_BROWSER_CODE_PRIVATE_5729';
  const access = 'GL_BROWSER_ACCESS_PRIVATE_5729', refresh = 'GL_BROWSER_REFRESH_PRIVATE_5729';
  let authorize, verifier, consents = 0, exchanges = 0, reads = 0;
  const privateValues = [code, access, refresh];
  await page.setViewportSize({ width, height: 900 }); await seed(this, 'ok');
  const redirect = new URL(this.baseURL); redirect.searchParams.set('operations_oauth_callback', 'gitlab');
  await this.context.route('https://gitlab.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/oauth/authorize') {
      authorize = url; consents++;
      assert.equal(url.searchParams.get('client_id'), clientId); assert.equal(url.searchParams.get('redirect_uri'), redirect.href);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('scope'), 'read_user');
      assert.equal(url.searchParams.has('client_secret'), false);
      // Matching state from the wrong window must not authorize a private exchange.
      await page.evaluate(({ state, code }) => window.postMessage({ source: 'operations-gitlab-oauth-callback', state, code }, location.origin),
        { state: url.searchParams.get('state'), code });
      const callback = new URL(redirect); callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set(consents === 1 ? 'error' : 'code', consents === 1 ? 'access_denied' : code);
      // A real provider document can sever the opener under COOP. The callback
      // must return through the same-origin channel rather than that WindowProxy.
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html', 'Cross-Origin-Opener-Policy': 'same-origin' },
        body: '<!doctype html><title>Synthetic GitLab sign-in</title><script>location.replace('+JSON.stringify(callback.href)+')</script>' });
    }
    assert.equal(request.headers().cookie, undefined); assert.equal(request.headers().referer, undefined);
    if (url.pathname === '/oauth/token') {
      exchanges++; const body = new URLSearchParams(request.postData()); verifier = body.get('code_verifier'); privateValues.push(verifier);
      assert.equal(body.get('client_id'), clientId); assert.equal(body.get('redirect_uri'), redirect.href);
      assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('code'), code); assert.equal(body.has('client_secret'), false);
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), authorize.searchParams.get('code_challenge'));
      return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, scope: 'read_user' }) });
    }
    assert.equal(url.pathname, '/api/v4/user'); assert.equal(request.headers().authorization, 'Bearer '+access); reads++;
    return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"id":42,"username":"gitlab_user"}' });
  });
  const name = 'GitLab OAuth fixture';
  const document = { openapi: '3.0.3', info: { title: name, version: '1' }, servers: [{ url: 'https://gitlab.com' }],
    security: [{ http: [] }, { oauth2: [] }, { apiKey: [] }],
    components: { securitySchemes: { http: { type: 'http', scheme: 'bearer' },
      // Match the normalized native alternative; uploaded documents use the canonical HTTP model.
      oauth2: { type: 'http', scheme: 'bearer' },
      apiKey: { type: 'apiKey', in: 'header', name: 'PRIVATE-TOKEN' } } },
    paths: { '/api/v4/user': { get: { operationId: 'currentUser', summary: name,
      responses: { 200: { description: 'Current user', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
  await setMode(page, 'settings'); const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'gitlab-oauth.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable '+name, exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: /oauth2/, exact: false }).click();
  const unlock = page.getByLabel('Unlock the vault password', { exact: true });
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Connect GitLab account', { exact: true }).click();
  await page.getByLabel('GitLab application ID', { exact: true }).fill(clientId);
  await expect(page.getByLabel('GitLab redirect URL', { exact: true })).toHaveValue(redirect.href);
  await page.getByLabel('GitLab connection name', { exact: true }).fill('GitLab connection');
  const deniedWindow = this.context.waitForEvent('page');
  await page.getByRole('button', { name: 'Connect GitLab', exact: true }).click();
  const denied = await deniedWindow;
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-in was not completed.' })).toBeVisible();
  await expect.poll(() => denied.isClosed()).toBe(true); assert.equal(exchanges, 0);
  const opened = this.context.waitForEvent('page');
  await page.getByRole('button', { name: 'Connect GitLab', exact: true }).click();
  const popup = await opened;
  await expect.poll(() => exchanges).toBe(1);
  await expect.poll(() => popup.isClosed()).toBe(true);
  const connection = page.getByRole('combobox', { name: 'Saved HTTP connection', exact: true });
  await expect(connection).toContainText('GitLab connection · GitLab @gitlab_user');
  const binding = async () => (await repository(page, 'list')).flatMap(document => document.nodes).find(node => node.data?.name === name)?.data.credentialBinding;
  await expect.poll(async () => (await binding())?.connection?.revision).toBe(1); assert.deepEqual((await binding()).credentials, {});
  assert.equal(reads, 1); assert.ok(verifier);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(connection).toContainText('GitLab connection · GitLab @gitlab_user'); await expect(connection).toBeEnabled();
  await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  assert.equal(exchanges, 1); assert.equal(reads, 2);
  for (const value of [await page.locator('body').innerText(), await repository(page, 'list'), await storage(page, 'read')])
    for (const secret of privateValues) assert.ok(!JSON.stringify(value).includes(secret));
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, ...privateValues]), []);
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/gitlab-oauth-${width}.png` });
});

Then('a Cloudflare upload at {int} pixels carries opaque session references through private worker calls', { timeout: 90_000 }, async function (width) {
  const page = this.page, account = 'a'.repeat(32), hash = 'b'.repeat(32), seen = [];
  const file = { kind: 'workflow-file', version: 1, name: 'index.html', mediaType: 'text/html', size: 4, base64: 'AP8NCg==' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = label => encode({ alg: 'HS256' })+'.'+encode({ exp: Math.floor(Date.now()/1000)+3600, label })+'.c3ludGhldGlj';
  const uploadToken = token('CF_BROWSER_UPLOAD_PRIVATE'), completionToken = token('CF_BROWSER_COMPLETION_PRIVATE');
  await page.setViewportSize({ width, height: 900 }); await seed(this, 'ok');
  await this.context.route('https://api.cloudflare.com/**', async route => {
    const request = route.request(), headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(request.url()), authorization = request.headers().authorization, body = request.postData() ?? '';
    seen.push({ url: request.url(), headers: request.headers(), body });
    let result;
    if (url.pathname.endsWith('/assets-upload-session')) {
      assert.equal(authorization, 'Bearer '+canaries[1]);
      assert.deepEqual(JSON.parse(body).manifest, { '/index.html': { hash, size: 4 } }); result = { jwt: uploadToken, buckets: [[hash]] };
    } else if (url.pathname.endsWith('/assets/upload')) {
      assert.equal(authorization, 'Bearer '+uploadToken); assert.equal(url.searchParams.get('base64'), 'true');
      assert.ok(body.includes('name="'+hash+'"')); assert.ok(body.includes('Content-Type: text/html')); assert.ok(body.includes(file.base64));
      assert.ok(!body.includes(completionToken)); result = { jwt: completionToken };
    } else {
      assert.ok(url.pathname.endsWith('/versions')); assert.equal(authorization, 'Bearer '+canaries[1]);
      assert.ok(body.includes('name="metadata"')); assert.ok(body.includes('application/json')); assert.ok(body.includes(completionToken));
      assert.ok(body.includes('export default {}')); assert.ok(!body.includes(uploadToken)); result = { id: 'browser-safe-version' };
    }
    return route.fulfill({ status: url.pathname.endsWith('/assets/upload') ? 201 : 200,
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, result }) });
  });
  const names = ['CF Start upload', 'CF Upload assets', 'CF Finish upload'];
  const contracts = [
    ['workers-session', '/accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session'],
    ['workers-upload', '/accounts/{account_id}/workers/assets/upload'],
    ['workers-version', '/accounts/{account_id}/workers/scripts/{script_name}/versions'],
  ];
  const paths = Object.fromEntries(contracts.map(([profile, path], index) => [path, { post: { operationId: profile, summary: names[index],
    'x-operations-cloudflare-upload': profile, security: [index === 1 ? { assets_jwt: [] } : { api_token: [] }],
    responses: { 200: { description: 'Safe upload result', content: { 'application/json': { schema: { type: 'object' } } } } } } }]));
  const document = { openapi: '3.0.3', info: { title: 'Cloudflare private upload fixture', version: '1' }, servers: [{ url: 'https://api.cloudflare.com/client/v4' }], paths,
    components: { securitySchemes: { api_token: { type: 'http', scheme: 'bearer' }, assets_jwt: { type: 'http', scheme: 'bearer', 'x-operations-cloudflare-upload-token': 'workers' } } } };
  await setMode(page, 'settings'); const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'cf-upload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable Cloudflare private upload fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  const readResult = async () => page.locator('[aria-label="Response body"]').last().evaluate(root => {
    const result = {};
    for (const line of root.querySelectorAll('.json-line')) {
      const key = line.querySelector('.json-key'), value = line.querySelector('.json-value > span');
      if (key && value) result[JSON.parse(key.textContent)] = JSON.parse(value.textContent);
    }
    return { result };
  });
  const execute = async () => {
    await page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
    return readResult();
  };
  async function accountCredentials() {
    await page.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
    await page.getByRole('option', { name: 'api_token', exact: true }).click();
    const unlock = page.getByLabel('Unlock the vault password', { exact: true });
    if (await unlock.isVisible()) { await unlock.fill(canaries[0]); await page.getByRole('button', { name: 'Unlock', exact: true }).click(); }
    await page.getByRole('combobox', { name: 'Credential for api_token', exact: true }).click();
    await page.getByRole('option', { name: canaries[3], exact: true }).click();
  }
  await chooseCatalogOperation(page, names[0]); await accountCredentials();
  await page.getByRole('textbox', { name: 'account_id', exact: true }).fill(account);
  await page.getByRole('textbox', { name: 'script_name', exact: true }).fill('test-worker');
  await page.getByRole('textbox', { name: 'manifest', exact: true }).fill(JSON.stringify({ '/index.html': { hash, size: 4 } }));
  const started = await execute(); assert.equal(started.result.phase, 'upload');
  await chooseCatalogOperation(page, names[1]);
  await page.getByRole('textbox', { name: 'account_id', exact: true }).fill(account);
  await page.getByRole('checkbox', { name: 'Do not send Private upload session', exact: true }).uncheck();
  await page.getByRole('textbox', { name: 'Private upload session', exact: true }).fill(started.result.session);
  await page.getByRole('textbox', { name: 'files', exact: true }).fill(JSON.stringify({ [hash]: file }));
  const uploaded = await execute(); assert.equal(uploaded.result.phase, 'completion'); assert.notEqual(uploaded.result.session, started.result.session);
  await chooseCatalogOperation(page, names[2]); await accountCredentials();
  await page.getByRole('textbox', { name: 'account_id', exact: true }).fill(account);
  await page.getByRole('textbox', { name: 'script_name', exact: true }).fill('test-worker');
  await page.getByRole('textbox', { name: 'metadata', exact: true }).fill(JSON.stringify({ main_module: 'main.js', assets: { jwt: uploaded.result.session } }));
  await page.getByRole('textbox', { name: 'files', exact: true }).fill(JSON.stringify({ 'main.js': { kind: 'workflow-file', version: 1, name: 'main.js', mediaType: 'application/javascript', size: 17, base64: Buffer.from('export default {}').toString('base64') } }));
  const completed = await execute(); assert.equal(completed.result.completed, true); assert.equal(completed.result.id, 'browser-safe-version');
  assert.equal(seen.length, 3); for (const call of seen) { assert.equal(call.headers.cookie, undefined); assert.equal(call.headers.referer, undefined); }
  for (const value of [await page.locator('body').innerText(), await repository(page, 'list'), await storage(page, 'read')])
    for (const token of [uploadToken, completionToken]) assert.ok(!JSON.stringify(value).includes(token));
  assert.deepEqual(await invoke(page, 'persistedCanaries', [...privateCanaries, uploadToken, completionToken]), []);
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/cloudflare-upload-${width}.png` });
});
