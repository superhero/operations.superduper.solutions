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
  const changes = () => card.getByRole('region', { name: 'Schema changes' });
  await expect(changes().locator('.change-group > summary')).toHaveText('Google OAuth alternatives11 operations corrected');
  await expect(changes().locator('.change-group')).not.toHaveAttribute('open');
  await expect(changes().locator('.field-change').first()).toBeHidden();
  await expect(card.locator('svg.version-graph path')).not.toHaveCount(0);
  const published = await card.locator('[data-version-oid]').filter({ has: page.locator('.branch-labels', { hasText: 'Published' }) }).getAttribute('data-version-oid');
  const corrected = await card.locator('[data-version-oid].current').getAttribute('data-version-oid');
  const expectComparison = async (revision, parent) => {
    await expect(changes()).toHaveAttribute('data-revision', revision);
    await expect(changes()).toHaveAttribute('data-base', parent);
    await expect(card.locator('[data-version-oid].current')).toHaveAttribute('data-version-oid', revision);
    await expect(card.locator('[data-version-oid].comparison')).toHaveAttribute('data-version-oid', parent);
    const edge = card.locator('svg.version-graph path.comparison');
    await expect(edge).toHaveCount(1);
    await expect(edge).toHaveAttribute('data-child', revision);
    await expect(edge).toHaveAttribute('data-parent', parent);
    await expect(changes().locator('.diff-commit')).toContainText(revision.slice(0, 7));
    await expect(changes().locator('.comparison-parent[aria-pressed="true"]')).toContainText(parent.slice(0, 7));
  };
  await expectComparison(corrected, published);
  await changes().locator('.change-group > summary').click();
  await expect(changes().locator('.field-change > summary').first()).toContainText('/security');
  await card.locator(`[data-version-oid="${published}"] .version-card`).click();
  await expect(changes()).toContainText('Initial schema import. This commit establishes the starting document.');
  await expect(changes().locator('.import-fields')).not.toHaveAttribute('open');
  await expect(card.locator('svg.version-graph path.comparison')).toHaveCount(0);
  await card.locator(`[data-version-oid="${corrected}"] .version-card`).click();
  await expectComparison(corrected, published);
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
  const parents = changes().locator('.comparison-parent');
  await expect(parents).toHaveCount(2);
  const first = await parents.first().getAttribute('data-parent-oid');
  await expectComparison(current, first);
  const other = await parents.nth(1).getAttribute('data-parent-oid');
  await parents.nth(1).click();
  await expectComparison(current, other);
  await expect(changes().locator('.field-change > summary')).toHaveCount(1);
  await expect(changes().locator('.field-change > summary')).toContainText('/info/title');
  // Switching parents keeps the same selected commit and moves only its comparison.
  await parents.first().click();
  await expectComparison(current, first);
  await parents.nth(1).click();
  await expectComparison(current, other);
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/schema-history-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  assert.ok(await card.evaluate(element => element.scrollWidth <= element.clientWidth), 'Schema history fits a mobile card.');
  await page.screenshot({ path: `${this.artifactDirectory}/schema-history-mobile.png` });
});
