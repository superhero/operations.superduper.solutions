// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setMode } from './workspace.steps.mjs';
import { expandSchemaCard } from './schema-card.fixture.mjs';

Then('schema settings display correction branches diffs and persistent field conflict choices', async function () {
  const page = this.page;
  // Install just the representative real bundled service in the isolated profile.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('v1/catalogs/index'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state');
      const request = store.get('serviceDefaults');
      request.onsuccess = () => store.put(request.result.filter(id => id !== 'gcp-speech'), 'serviceDefaults');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    }); db.close();
  });
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  const open = async () => {
    await setMode(page, 'settings');
    const toggle = page.locator('summary[aria-label="Schemas"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const card = page.locator('.schema-card[data-schema-id="gcp-speech"]');
    await expandSchemaCard(card);
    return card;
  };
  let card = await open();
  const historyToggle = card.getByRole('button', { name: 'Schema history', exact: true });
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
  await historyToggle.click();
  await expect(card.getByRole('region', { name: 'Schema version history' })).toBeVisible();
  await expect(card.locator('.branch-heads')).toContainText('Published');
  await expect(card.locator('.branch-heads')).toContainText('Corrections');
  await expect(card.getByRole('button', { name: 'Apply bundled revision', exact: true })).toBeVisible();
  await expect(card.getByRole('region', { name: 'Schema changes' })).toContainText('/security');
  await expect(card.locator('svg.version-graph path')).not.toHaveCount(0);
  const published = await card.locator('[data-version-oid]').filter({ has: page.locator('.branch-labels', { hasText: 'Published' }) }).getAttribute('data-version-oid');
  const original = await page.evaluate(async oid => (await import('/schema-lifecycle-fixture.js')).readSchemaVersion('gcp-speech', oid), published);
  assert.ok(Object.values(original.paths).some(item => Object.values(item).some(operation => operation?.security?.some(requirement => requirement.Oauth2 && requirement.Oauth2c))));
  const name = card.getByRole('textbox', { name: 'Schema name', exact: true });
  await name.fill('My Speech API'); await name.press('Enter');
  await expect(name).toHaveValue('My Speech API');
  original.info.title = 'New upstream Speech title'; original.info.version = 'manual-update-2';
  await card.getByRole('button', { name: 'Replace My Speech API', exact: true }).click();
  await page.getByLabel('Replace OpenAPI document', { exact: true }).setInputFiles({ name: 'speech-upstream.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await expect(card.getByRole('region', { name: 'Review schema conflicts' })).toBeVisible();
  await expect(name).toHaveValue('My Speech API');
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  card = await open();
  const review = card.getByRole('region', { name: 'Review schema conflicts' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: 'Apply update', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Keep current: /info/title', exact: true }).click();
  await review.getByRole('button', { name: 'Apply update', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(card.getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue('My Speech API');
  await expect(card.locator('[data-version-oid].current .branch-labels')).toContainText('Working');
  const current = await card.locator('[data-version-oid]').filter({ has: page.locator('.branch-labels', { hasText: 'Working' }) }).getAttribute('data-version-oid');
  const merged = await page.evaluate(async oid => (await import('/schema-lifecycle-fixture.js')).readSchemaVersion('gcp-speech', oid), current);
  assert.equal(merged.info.title, 'My Speech API');
  assert.equal(merged.info.version, 'manual-update-2');
  assert.ok(Object.values(merged.paths).some(item => Object.values(item).some(operation => operation?.security?.some(requirement => requirement.Oauth2) && operation.security.some(requirement => requirement.Oauth2c))));
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/schema-history-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  assert.ok(await card.evaluate(element => element.scrollWidth <= element.clientWidth), 'Schema history fits a mobile card.');
  await page.screenshot({ path: `${this.artifactDirectory}/schema-history-mobile.png` });
});
