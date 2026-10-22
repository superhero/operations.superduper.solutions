// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog } from './workspace.fixture.mjs';
import { categoryLabel } from '../../src/lib/category-label.ts';

const password = 'keyboard-vault-password-6481';
const originalSecret = 'keyboard-BEARER-canary-6481';
const replacementSecret = 'keyboard-APIKEY-canary-6481';
const cancelledSecret = 'keyboard-CANCELLED-canary-6481';
const panel = page => page.getByRole('region', { name: 'Secrets vault', exact: true });
const readStorage = page => page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());

// Only real Tab/Shift+Tab traversal changes focus. Locator reads assert the destination;
// no click(), focus(), fill(), injected events or imperative focus is used.
async function tabTo(page, target) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 100; step++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    // Replaced forms can leave the native navigation starting point after the
    // new target. Traverse backward instead of assuming Tab wraps from browser
    // chrome back into the document (Firefox does not guarantee that behavior).
    const key = await target.evaluate(element => {
      const active = document.activeElement;
      return active && active !== document.body
        && (active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) ? 'Shift+Tab' : 'Tab';
    });
    const previous = await page.evaluateHandle(() => document.activeElement);
    try {
      await page.keyboard.press(key);
      // Observe native focus traversal before testing the next destination;
      // acknowledging key dispatch alone is not the focus assertion.
      await page.waitForFunction(element => document.activeElement !== element || !document.hasFocus(), previous);
    } finally { await previous.dispose(); }
  }
  const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName,
    id: document.activeElement?.id, type: document.activeElement?.getAttribute('type') }));
  assert.fail(`The keyboard could not reach ${await target.getAttribute('aria-label') ?? await target.getAttribute('id') ?? await target.textContent()}; focus=${JSON.stringify(focused)}`);
}
async function activate(page, target) {
  await tabTo(page, target);
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}
async function enter(page, target, value) {
  await tabTo(page, target);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
  await expect(target).toHaveValue(value);
}
async function unlock(page) {
  await enter(page, panel(page).getByLabel('Unlock password, or recovery key', { exact: true }), password);
  await activate(page, panel(page).getByRole('button', { name: 'Unlock vault', exact: true }));
  await expect(panel(page).getByLabel('Credential label', { exact: true })).toBeVisible();
}

Given('I open Secrets settings using only the keyboard', async function () {
  const page = this.page;
  await activate(page, page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }));
  await expect(page.getByRole('region', { name: 'Settings workspace', exact: true })).toBeVisible();
  const secrets = page.locator('summary[aria-label="Secrets"]');
  if (await secrets.getAttribute('aria-expanded') !== 'true') await activate(page, secrets);
  await expect(panel(page).getByText('No vault has been created:', { exact: true })).toBeVisible();
});

When('I create copy remove and save vault credentials using only the keyboard', { timeout: 90_000 }, async function () {
  const page = this.page, settings = panel(page);
  await enter(page, settings.getByLabel('New vault password', { exact: true }), password);
  await enter(page, settings.getByLabel('Confirm vault password', { exact: true }), password);
  await activate(page, settings.getByRole('button', { name: 'Create vault', exact: true }));
  const recovery = settings.locator('pre[aria-label="Generated recovery key"]');
  await expect(recovery).toHaveText(/^[A-Za-z0-9+/]{171}=$/);
  this.keyboardRecovery = await recovery.textContent();
  const recoveryHandle = await recovery.elementHandle();
  assert.equal((await readStorage(page)).snapshot, null);
  await activate(page, settings.getByRole('button', { name: 'Save recovery key', exact: true }));
  await expect(settings.getByLabel('Credential label', { exact: true })).toBeVisible();
  assert.equal(await recoveryHandle.evaluate(element => element.textContent), '');

  await enter(page, settings.getByLabel('Credential label', { exact: true }), 'Keyboard credential');
  await enter(page, settings.getByLabel('Credential value', { exact: true }), originalSecret);
  await activate(page, settings.getByRole('button', { name: 'Save credential', exact: true }));
  await expect(settings.getByLabel('Credential label', { exact: true })).toHaveValue('');
  await expect(settings.getByLabel('Credential value', { exact: true })).toHaveValue('');

  await page.evaluate(() => { navigator.clipboard.writeText = async value => { window.__keyboardCopied = value; }; });
  try {
    await activate(page, settings.getByRole('button', { name: 'Copy', exact: true }));
    await expect.poll(() => page.evaluate(() => window.__keyboardCopied)).toBe(originalSecret);
  } finally { await page.evaluate(() => { delete navigator.clipboard.writeText; delete window.__keyboardCopied; }); }
  await activate(page, settings.getByRole('button', { name: 'Remove', exact: true }));
  await expect(settings.locator('li')).toHaveCount(0);
  await enter(page, settings.getByLabel('Credential label', { exact: true }), 'Keyboard replacement');
  await expect(settings.getByRole('combobox', { name: 'Credential type', exact: true })).toHaveCount(0);
  await enter(page, settings.getByLabel('Credential value', { exact: true }), replacementSecret);
  await activate(page, settings.getByRole('button', { name: 'Save credential', exact: true }));
  await expect(settings.getByLabel('Credential label', { exact: true })).toHaveValue('');
  const row = settings.locator('li').filter({ hasText: 'Keyboard replacement' });
  await expect(row).toHaveCount(1);
  await expect(settings.getByLabel('Credential value', { exact: true })).toHaveValue('');
  this.keyboardSaved = await readStorage(page);
});

Then('keyboard cancellation and locking clear unsaved secrets without saving them', { timeout: 90_000 }, async function () {
  const page = this.page, settings = panel(page);
  await enter(page, settings.getByLabel('Credential value', { exact: true }), cancelledSecret);
  const valueHandle = await settings.getByLabel('Credential value', { exact: true }).elementHandle();
  await activate(page, settings.getByRole('button', { name: 'Add passkey', exact: true }));
  const passkey = settings.locator('form[id$="-passkey"]');
  await enter(page, passkey.getByLabel('Password', { exact: true }), password);
  const proofHandle = await passkey.getByLabel('Password', { exact: true }).elementHandle();
  await activate(page, settings.locator('.vault-passkey-row').getByRole('button', { name: 'Cancel', exact: true }));
  assert.equal(await proofHandle.evaluate(element => element.value), '');
  assert.deepEqual(await readStorage(page), this.keyboardSaved);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(settings.getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  assert.equal(await valueHandle.evaluate(element => element.value), '');
  assert.deepEqual(await readStorage(page), this.keyboardSaved);
  await unlock(page);
  await expect(settings.locator('li').filter({ hasText: 'Keyboard replacement' })).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(settings.getByRole('button', { name: 'Unlock vault', exact: true })).toBeVisible();
  await expect(settings.getByLabel('Unlock password, or recovery key', { exact: true })).toHaveValue('');
  const canaries = [password, originalSecret, replacementSecret, cancelledSecret, this.keyboardRecovery];
  const found = await page.evaluate(async canaries => (await import('/vault-storage-fixture.js')).persistedCanaries(canaries), canaries);
  assert.deepEqual(found, []);
});

Then('keyboard credential selection sends only the selected saved value without approval', { timeout: 90_000 }, async function () {
  const page = this.page, run = randomUUID(), operationName = 'Keyboard credential request';
  const path = `/vault-api/${run}/ok`;
  const document = { openapi: '3.1.0', info: { title: 'Keyboard credential fixture', version: '1.0.0' },
    servers: [{ url: this.baseURL }], components: { securitySchemes: { Key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } } },
    paths: { [path]: { get: { operationId: 'keyboard-credential', summary: operationName, security: [{ Key: [] }],
      responses: { 200: { description: 'Accepted', content: { 'application/json': { schema: { type: 'object' } } } } },
    } } },
  };
  await activate(page, page.locator('summary[aria-label="Schemas"]'));
  // The fixture file is supplied to the native chooser; all application controls,
  // including opening that chooser, are reached and activated by keyboard.
  const picker = page.waitForEvent('filechooser');
  await activate(page, page.getByRole('button', { name: 'Upload OpenAPI document', exact: true }));
  await (await picker).setFiles({ name: 'keyboard-credential.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable Keyboard credential fixture', exact: true }))
    .toHaveAttribute('aria-checked', 'true');
  await activate(page, page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }));
  await openCatalog(page);
  const catalog = page.getByRole('navigation', { name: 'Operation catalog', exact: true });
  const entry = catalog.locator('[data-operation-name]').filter({ hasText: operationName });
  const heading = catalog.locator('[data-catalog-group] > .catalog-group > summary').filter({ hasText: new URL(this.baseURL).host }).first();
  if (await heading.getAttribute('aria-expanded') !== 'true') await activate(page, heading);
  let root = heading.locator('xpath=ancestor::*[@data-catalog-group][1]');
  for (const name of ['vault-api', run, 'ok']) {
    const child = root.locator(':scope > .catalog-group > .disclosure-panel > .catalog-children > .catalog-branch > .catalog-group > summary')
      .filter({ has: page.getByText(categoryLabel(name), { exact: true }) });
    if (await child.getAttribute('aria-expanded') !== 'true') await activate(page, child);
    root = child.locator('xpath=../..');
  }
  await activate(page, entry.getByRole('button', { name: `Add to workflow: ${operationName}`, exact: true }));
  await page.keyboard.press('Escape');
  await activate(page, page.getByRole('button', { name: 'Run workflow', exact: true }));
  const chooseLast = async name => {
    await activate(page, page.getByRole('combobox', { name, exact: true }));
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
  };
  await chooseLast('Authentication alternative');
  await enter(page, page.getByLabel('Unlock the vault password', { exact: true }), password);
  await activate(page, page.getByRole('button', { name: 'Unlock', exact: true }));
  await chooseLast('Credential for Key');
  const selection = page.locator('fieldset.credential-selection');
  await expect(selection).toContainText(`${this.baseURL}${path}`);
  await expect(selection).toContainText('X-Api-Key');
  await expect(page.getByRole('button', { name: 'Approve credential use', exact: true })).toHaveCount(0);
  await activate(page, page.getByRole('button', { name: /^(Start workflow|Run operation|Retry operation)$/ }));
  const response = page.getByRole('region', { name: 'Step 1 response', exact: true });
  await expect(response).toContainText('HTTP 200');
  await expect(page.getByRole('combobox', { name: 'Authentication alternative', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Credential for Key', exact: true })).toBeDisabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  assert.ok(!(await response.innerText()).includes(replacementSecret));
  const observed = await (await this.context.request.get(`${this.baseURL}/vault-api/${run}/observations`)).json();
  assert.equal(observed.length, 1);
  assert.equal(observed[0].headers['x-api-key'], replacementSecret);
  assert.equal(observed[0].headers.authorization, undefined);
  assert.equal(observed[0].headers.cookie, undefined);
  assert.equal(observed[0].headers.referer, undefined);
});
