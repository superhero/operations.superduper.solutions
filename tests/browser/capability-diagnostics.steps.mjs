// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { openCatalog, searchOperations, setMode } from './workspace.fixture.mjs';
import { extractOperations } from '../../src/lib/catalog.ts';
import { capabilityAreaLabels, readOperationCapabilities } from '../../src/lib/operation-capabilities.ts';
import { capabilityDocument } from '../capability-diagnostics.fixture.mjs';

Then('operation limitations show independent causes and authentication choices without model loading', async function () {
  const document = { openapi: '3.1.0', info: { title: 'Independent capability UI fixture', version: '1' },
    servers: [{ url: 'https://capability-fixture.example.test' }],
    components: { securitySchemes: { UnsupportedFixtureAuth: { type: 'http', scheme: 'fixture-unrepresentable' }, Bearer: { type: 'http', scheme: 'bearer' } } },
    paths: { '/credentials': { get: { operationId: 'privateRequirements', summary: 'Inspect independent credential requirements',
      'x-operations-credential-result': true, security: [{ UnsupportedFixtureAuth: [] }, { Bearer: [] }, {}],
      responses: { '200': { description: 'A private result without a reviewed adoption contract.', content: {
        'application/json': { schema: { type: 'object', properties: { token: { type: 'string' } } } },
      } } } } } } };
  const page = this.page;
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  const documents = page.getByRole('region', { name: 'OpenAPI documents', exact: true });
  await expect(documents).toHaveAttribute('aria-busy', 'false');
  await documents.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'independent-capabilities.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  const card = documents.locator('.schema-card').filter({ has: page.getByRole('button', { name: `Schema details: ${document.info.title}`, exact: true }) });
  await expect(card).toHaveCount(1);
  const id = await card.getAttribute('data-schema-id');
  await expect(documents).toHaveAttribute('aria-busy', 'false');
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  const operation = extractOperations(document, id)[0];
  const capabilities = readOperationCapabilities(operation);
  assert.deepEqual(capabilities.issues.map(issue => issue.area), ['response']);
  assert.deepEqual(capabilities.alternatives.map(alternative => alternative.supported), [false, true, true]);
  assert.ok(capabilities.alternatives[0].reasons.length, 'Unsupported authentication has an independent explanation.');
  await openCatalog(page); await searchOperations(page, operation.name);
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  const nodesBefore = await page.locator('.svelte-flow__node-operation').count();
  await page.evaluate(() => {
    globalThis.capabilityModelRequests = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.method === 'models') globalThis.capabilityModelRequests.push(structuredClone(message));
      return original.call(this, message, ...args);
    };
  });
  const row = page.locator(`[data-operation-id="${operation.id}"] > .catalog-operation-action`);
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  if (touch) await row.tap({ force: true });
  else { await row.focus(); await page.keyboard.press('Enter'); }
  const dialog = page.getByRole('dialog', { name: `Requirements: ${operation.name}`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-capability-details]')).toBeFocused();
  for (const issue of capabilities.issues) {
    await expect(dialog.getByText(issue.message, { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText(capabilityAreaLabels[issue.area], { exact: true }).first()).toBeVisible();
  }
  for (const alternative of capabilities.alternatives) {
    const entry = dialog.locator(`[data-auth-alternative="${alternative.id}"]`);
    await expect(entry).toContainText(alternative.names.join(' + ') || 'Without credentials');
    await expect(entry).toContainText(alternative.supported ? 'Supported' : 'Unavailable');
    for (const reason of alternative.reasons ?? []) await expect(entry).toContainText(reason);
  }
  if (touch) await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
  else await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden(); await expect(row).toBeFocused();
  assert.deepEqual(await page.evaluate(() => globalThis.capabilityModelRequests), []);
  assert.equal(await page.locator('.svelte-flow__node-operation').count(), nodesBefore);
});

Then('canonical capability diagnostics survive discovery refresh and cannot publish private authority', async function () {
  const result = await this.page.evaluate(async document => {
    const api = globalThis.schemaFixture;
    const metadata = await api.setupCapabilities(document), identity = api.schemaMetadataIdentity(metadata);
    const before = api.counters();
    const first = await api.readSchemaDiscovery(metadata.id);
    const obsolete = structuredClone(first); obsolete.version = 1;
    obsolete.operations[0].capabilitySummary = { i: [] }; delete obsolete.operations[0].unavailableReason;
    await api.editStore('indexes', metadata.id, { identity, discovery: obsolete });
    const discovery = await api.readSchemaDiscovery(metadata.id), afterDiscovery = api.counters();
    let blockedReason = '';
    try { await api.readSchemaOperations(metadata.id, identity, [discovery.operations[0].id]); }
    catch (error) { blockedReason = error.message; }
    const forged = { ...discovery.operations[0], deferred: undefined, capabilities: { issues: [] }, unavailableReason: undefined,
      security: [[{ name: 'Bearer', kind: 'bearer', header: 'Authorization' }]] };
    const descriptor = await api.approvedOperation(forged, 'https://example.test');
    let unapproved = false;
    try { await api.assertCurrentSchema(descriptor); } catch (error) { unapproved = error.code === 'PERMISSION'; }
    await api.setSchemaDocumentEnabled(metadata.id, false, { metadataOnly: true });
    const beforeDisabled = api.counters(); await api.listSchemaMetadata(); const afterDisabled = api.counters();
    return { before, afterDiscovery, discovery, blockedReason, unapproved, beforeDisabled, afterDisabled };
  }, capabilityDocument());
  assert.deepEqual(result.before.reads, result.afterDiscovery.reads);
  assert.equal(result.afterDiscovery.indexes['capability-fixture'], 2);
  assert.equal(result.discovery.version, 2);
  assert.match(result.blockedReason, /cookie parameter "session"/); assert.ok(result.unapproved);
  assert.deepEqual(result.beforeDisabled, result.afterDisabled);
  assert.ok(readOperationCapabilities(result.discovery.operations[0]).issues.length >= 4);
});
