// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode } from './workspace.steps.mjs';

const password = 'browser-VAULT-password-9182';
const secret = 'browser-BEARER-canary-9182';
const label = 'browser-PRIVATE-label-9182';
const panel = page => page.getByRole('region', { name: 'Secrets vault', exact: true });
const readStorage = page => page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());

async function openSecrets(page) {
  await setMode(page, 'settings');
  const disclosure = page.locator('summary[aria-label="Secrets"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await expect(panel(page).getByRole('button', { name: /^(?:Import|Replace) vault$/ })).toBeEnabled();
}

Then('its native passkey cannot restore on another RP domain before I explicitly choose {string}',
  { timeout: 90_000 }, async function (method) {
    assert.equal(this.browser.browserType().name(), 'chromium', 'This native authenticator case requires Chromium CDP');
    assert.ok(['password', 'recovery'].includes(method));
    const page = this.page, originalOrigin = this.baseURL;
    const destination = new URL(originalOrigin); destination.hostname = 'restore.localhost';
    const cdp = await this.context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'usb', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      hasPrf: true, hasHmacSecret: true,
    } });
    try {
      await panel(page).getByLabel('Confirm action password', { exact: true }).fill(password);
      await panel(page).getByRole('button', { name: 'Add passkey', exact: true }).click();
      await expect(panel(page).getByRole('status')).toContainText('Passkey verified and added');
      const original = await readStorage(page);
      const passkey = original.snapshot.envelopes.find(envelope => envelope.kind === 'passkey');
      assert.ok(passkey);
      // Positive control with this same authenticator: a functioning original-RP
      // assertion must unlock the real vault before the different-RP attempt.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await panel(page).getByRole('button', { name: 'Use passkey', exact: true }).click();
      await expect(panel(page).getByLabel('Unlock password or recovery key', { exact: true })).toHaveCount(0);
      await panel(page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
      await expect(panel(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
      await expect(panel(page).locator('li').getByText(label, { exact: true })).toBeVisible();
      const enrolled = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
      assert.equal(enrolled.length, 1); assert.equal(enrolled[0].rpId, 'localhost');

      await panel(page).getByRole('combobox', { name: 'Confirm action method', exact: true }).click();
      await page.getByRole('option', { name: 'Password', exact: true }).click();
      await panel(page).getByLabel('Confirm action password', { exact: true }).fill(password);
      const downloadEvent = page.waitForEvent('download');
      await panel(page).getByRole('button', { name: 'Export vault', exact: true }).click();
      const stream = await (await downloadEvent).createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const backup = Buffer.concat(chunks);
      for (const canary of [password, secret, label, this.uiRecovery]) assert.ok(!backup.toString().includes(canary));

      // Serve the same production build at another secure localhost domain.
      // Fulfil only this alias; native WebAuthn still sees restore.localhost.
      await this.context.route(`${destination.origin}/**`, async route => {
        const request = new URL(route.request().url());
        const response = await route.fetch({ url: `${originalOrigin}${request.pathname}${request.search}` });
        await route.fulfill({ response });
      });
      await page.goto(destination.origin);
      await page.locator('#startup-status').waitFor({ state: 'detached' });
      await openSecrets(page);
      assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, host: location.hostname })),
        { secure: true, host: 'restore.localhost' });
      await expect(panel(page).getByText('No vault has been created:', { exact: true })).toBeVisible();
      const emptyDestination = await readStorage(page);
      assert.equal(emptyDestination.snapshot, null);
      await panel(page).getByLabel('Encrypted vault export', { exact: true }).setInputFiles({
        name: 'other-domain-vault.json', mimeType: 'application/json', buffer: backup,
      });
      await panel(page).getByRole('combobox', { name: 'Export method', exact: true }).click();
      await page.getByRole('option', { name: 'Passkey', exact: true }).click();
      await expect(panel(page).getByLabel('Export password', { exact: true })).toHaveCount(0);

      // A provider may wait indefinitely when its credential belongs to another
      // RP. Bound only that native wait with cancellation; do not replace the
      // browser ceremony, its PRF result, or the application's error handling.
      await page.evaluate(() => {
        const nativeGet = navigator.credentials.get.bind(navigator.credentials);
        globalThis.vaultOriginAttempt = { calls: 0, returnedCredential: false };
        navigator.credentials.get = async options => {
          const attempt = globalThis.vaultOriginAttempt;
          attempt.calls++; attempt.rpId = options.publicKey.rpId ?? location.hostname;
          attempt.allowCredentials = options.publicKey.allowCredentials.length;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          try {
            const credential = await nativeGet({ ...options,
              signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]) });
            attempt.returnedCredential = credential !== null;
            return credential;
          } catch (error) { attempt.error = error.name; throw error; }
          finally { clearTimeout(timer); navigator.credentials.get = nativeGet; }
        };
      });
      let assertions = 0;
      const asserted = () => { assertions++; };
      cdp.on('WebAuthn.credentialAsserted', asserted);
      await panel(page).getByRole('button', { name: 'Authenticate and import vault', exact: true }).click();
      await expect(panel(page).getByRole('alert')).toContainText('cancelled');
      cdp.off('WebAuthn.credentialAsserted', asserted);
      const attempt = await page.evaluate(() => globalThis.vaultOriginAttempt);
      assert.equal(attempt.calls, 1); assert.equal(attempt.rpId, 'restore.localhost');
      assert.equal(attempt.allowCredentials, 1); assert.equal(attempt.returnedCredential, false);
      assert.ok(['AbortError', 'NotAllowedError'].includes(attempt.error));
      assert.equal(assertions, 0, 'The original RP credential must not assert for the destination RP');
      assert.deepEqual(await readStorage(page), emptyDestination);
      await expect(panel(page).getByRole('combobox', { name: 'Export method', exact: true })).toContainText('Passkey');
      await expect(panel(page).getByLabel('Export password', { exact: true })).toHaveCount(0);
      const retained = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
      assert.equal(retained.length, 1); assert.equal(retained[0].rpId, 'localhost');
      assert.equal(retained[0].signCount, enrolled[0].signCount);

      await panel(page).getByRole('combobox', { name: 'Export method', exact: true }).click();
      await page.getByRole('option', { name: method === 'password' ? 'Password' : 'Recovery key', exact: true }).click();
      const input = panel(page).getByLabel(method === 'password' ? 'Export password' : 'Export recovery key', { exact: true });
      await input.fill(method === 'password' ? password : this.uiRecovery);
      const inputHandle = await input.elementHandle();
      await panel(page).getByRole('button', { name: 'Authenticate and import vault', exact: true }).click();
      await expect(panel(page).getByRole('heading', { name: 'Confirm management actions', exact: true })).toBeVisible();
      await expect(panel(page).locator('li').getByText(label, { exact: true })).toBeVisible();
      assert.equal(await inputHandle.evaluate(element => element.value), '');
      await inputHandle.dispose();
      const restored = await readStorage(page);
      assert.equal(restored.snapshot.records.length, 1);
      assert.deepEqual(restored.snapshot.envelopes.find(envelope => envelope.kind === 'passkey'), passkey);
      const canaries = [password, secret, label, this.uiRecovery];
      assert.deepEqual(await page.evaluate(async values =>
        (await import('/vault-storage-fixture.js')).persistedCanaries(values), canaries), []);
      await page.goto(originalOrigin);
      await page.locator('#startup-status').waitFor({ state: 'detached' });
      assert.deepEqual((await readStorage(page)).snapshot, original.snapshot);
      await this.attach(JSON.stringify({ sourceRP: 'localhost', destinationRP: 'restore.localhost',
        originalRPNativeUnlock: true,
        nativeAssertion: 'no matching RP credential; bounded cancellation', restoreMethod: method,
        sourceSnapshotUnchanged: true, physicalProviderVerified: false }), 'application/vnd.operations.passkey-origin+json');
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }); await cdp.detach();
    }
  });
