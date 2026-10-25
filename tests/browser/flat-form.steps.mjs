// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { inspectServiceSchema } from '../../src/lib/service-catalog.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { flatFormPath, flatFormValues } from '../flat-form.fixture.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { setMode, workflowAction } from './workspace.fixture.mjs';

Then('the saved {string} form selects its last optional pair without rendering every field', { timeout: 60_000 }, async function (kind) {
  const page = this.page, source = JSON.parse(gunzipSync(await readFile('src/catalogs/services/twilio.json.gz'))), path = flatFormPath(kind), origin = `${this.baseURL}/twilio-flat-api/${randomUUID()}`;
  source.paths = { [path]: source.paths[path] }; source.paths[path].servers = [{ url: origin }]; source.paths[path].post.security = []; source.security = [];
  const operation = inspectServiceSchema(source, 'twilio', new Set([`twilio:${kind}`])).operations[0];
  assert.equal(operation.unavailableReason, undefined);
  await page.evaluate(async source => {
    const api = await import('/schema-lifecycle-fixture.js'), now = Date.now();
    await api.setupCapabilities(source, 'twilio');
    await api.putSchemaDocument({ id: 'twilio', file: 'bounded-twilio.json', document: source, enabled: true, createdAt: now, updatedAt: now });
  }, source);
  await repository(page, 'save', { version: 3, id: 'flat-form-workflow', name: 'Bounded Twilio workflow',
    ...createOperationGraph(operation, { x: 0, y: 0 }, 'twilio-form', source), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false }, null);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Bounded Twilio workflow', exact: true }), values = flatFormValues(kind);
  await expect(run.locator('.operation-field')).toHaveCount(7);
  for (const name of ['AccountSid', 'CallSid']) await run.getByRole('textbox', { name, exact: true }).fill(values[`path:${name}`]);
  if (kind === 'CreateStream') await run.getByRole('textbox', { name: 'Url', exact: true }).fill(values['body:Url']);
  for (const name of ['Parameter99.Name', 'Parameter99.Value']) {
    await run.getByRole('combobox', { name: 'Add request body field', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(run.getByRole('textbox', { name, exact: true })).toBeEnabled();
    await run.getByRole('textbox', { name, exact: true }).fill(values[`body:${name}`]);
  }
  await expect(run.locator('.operation-field')).toHaveCount(9);
  assert.ok(await run.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await page.screenshot({ path: `${this.artifactDirectory}/flat-form-${page.viewportSize().width}.png` });
  const requests = [];
  await page.route(`${origin}/**`, async route => {
    const request = route.request(), form = new URLSearchParams(request.postData());
    requests.push(Object.fromEntries(form)); assert.match(request.headers()['content-type'], /^application\/x-www-form-urlencoded/);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, fields: Object.fromEntries(form) }) });
  });
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  assert.equal(requests.length, 1); assert.equal(requests[0]['Parameter99.Name'], 'last'); assert.equal(requests[0]['Parameter99.Value'], '最後');
  assert.equal(requests[0]['Parameter1.Name'], undefined); assert.equal(requests[0].Parameter, undefined);
  const response = run.getByRole('region', { name: 'Step 1 response', exact: true });
  await expect(response).toContainText('Parameter99.Name'); await expect(response).toContainText('最後');
});
