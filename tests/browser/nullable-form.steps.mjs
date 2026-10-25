// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { nullableFormDocument } from '../nullable-form.fixture.mjs';
import { extractOperations } from '../../src/lib/catalog.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { repository } from './workflow-storage.fixture.mjs';
import { setMode, workflowAction } from './workspace.fixture.mjs';

Then('a saved nullable file operation rejects null and uploads its exact file privately', { timeout: 60_000 }, async function () {
  const page = this.page, token = randomUUID(), origin = `${this.baseURL}/nullable-form-api/${token}`;
  const source = nullableFormDocument(origin, true), id = 'nullable-file-browser', operation = extractOperations(source, id)[0];
  await page.evaluate(async ({ id, source }) => {
    const api = await import('/schema-lifecycle-fixture.js'), now = Date.now();
    await api.putSchemaDocument({ id, file: 'nullable-files.json', document: source, enabled: true, createdAt: now, updatedAt: now });
  }, { id, source });
  await repository(page, 'save', { version: 3, id: 'nullable-file-workflow', name: 'Nullable file workflow',
    ...createOperationGraph(operation, { x: 0, y: 0 }, 'upload', source), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false }, null);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Nullable file workflow', exact: true });
  const nullFile = run.getByRole('checkbox', { name: /^Send file as null$/i }); await nullFile.check();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByText(/explicit null has no qualified file encoding/)).toBeVisible();
  const before = await this.context.request.get(`${origin}/observations`); assert.equal((await before.json()).calls, 0);
  await nullFile.uncheck();
  await run.getByLabel(/^file$/i).setInputFiles({ name: 'payload.bin', mimeType: 'image/png', buffer: Buffer.from([0, 1, 127, 255, 65]) });
  await expect(run.getByText('payload.bin', { exact: true })).toBeVisible();
  await run.getByRole('combobox', { name: 'Authentication alternative', exact: true }).click();
  await page.getByRole('option', { name: 'Bearer', exact: true }).click();
  await run.getByLabel('Unlock the vault password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock', exact: true }).click();
  await run.getByRole('combobox', { name: 'Credential for Bearer', exact: true }).click();
  await page.getByRole('option', { name: 'browser-PRIVATE-label-9182', exact: true }).click();
  await run.getByRole('button', { name: /^(Start workflow|Retry operation)$/ }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  const response = run.getByRole('region', { name: 'Step 1 response', exact: true });
  for (const value of ['payload.bin', 'image/png', Buffer.from([0, 1, 127, 255, 65]).toString('base64'), 'multipart/form-data; boundary=']) await expect(response).toContainText(value);
  await expect(response).toContainText(/"authorized":\s*true/); await expect(run).not.toContainText('browser-BEARER-canary-9182');
  assert.equal((await (await this.context.request.get(`${origin}/observations`)).json()).calls, 1);
});
