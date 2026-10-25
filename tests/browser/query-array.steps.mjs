// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { queryArrayDocument } from '../query-array.fixture.mjs';
import { extractOperations } from '../../src/lib/catalog.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { repository } from './workflow-storage.fixture.mjs';
import { setMode, workflowAction } from './workspace.fixture.mjs';

Then(/^a saved (public|private) workflow preserves comma array bytes through its real request path$/, { timeout: 60_000 }, async function (path) {
  const privateRequest = path === 'private', source = queryArrayDocument(`${this.baseURL}/query-array-api/${randomUUID()}`, privateRequest);
  const id = 'query-array-browser', operation = extractOperations(source, id)[0], page = this.page;
  await page.evaluate(async ({ id, source }) => {
    const api = await import('/schema-lifecycle-fixture.js');
    const now = Date.now(); await api.putSchemaDocument({ id, file: 'query-arrays.json', document: source, enabled: true, createdAt: now, updatedAt: now });
  }, { id, source });
  const document = { version: 3, id: 'query-array-workflow', name: 'Query array workflow', ...createOperationGraph(operation, { x: 0, y: 0 }, 'read', source),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', document, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Query array workflow', exact: true });
  await run.getByRole('checkbox', { name: /^Do not send colors$/i }).uncheck();
  await run.getByLabel(/^colors$/i).fill('["a,b","space value","%2C"]');
  if (privateRequest) {
    await run.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
    await page.getByRole('option', { name: 'Key', exact: true }).click();
    await run.getByLabel('Unlock the vault password', { exact: true }).fill('browser-VAULT-password-9182');
    await run.getByRole('button', { name: 'Unlock', exact: true }).click();
    await run.getByRole('combobox', { name: 'Credential for Key', exact: true }).click();
    await page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true }).click();
  }
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  const result = run.getByRole('region', { name: 'Step 1 response', exact: true });
  await expect(result).toContainText('colors=a%2Cb,space%20value,%252C');
  await expect(result).toContainText('"a,b"'); await expect(result).toContainText('"space value"');
  await expect(result).toContainText(new RegExp(`"credentialPresent":\\s*${privateRequest}`));
  await expect(run).not.toContainText('browser-BEARER-canary-9182');
});
