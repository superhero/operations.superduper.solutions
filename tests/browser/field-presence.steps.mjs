// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { chooseCatalogOperation, executeOperation, includeField, field, fillField, quitRun, restartRun, setMode, workflowAction, workspace } from './workspace.steps.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const omitted = (page, label) => workspace(page).getByRole('checkbox', { name: `Do not send ${label}`, exact: true });
const nullValue = (page, label) => workspace(page).getByRole('checkbox', { name: `Send ${label} as null`, exact: true });
const information = (page, label) => workspace(page).getByRole('button', { name: `About ${label}`, exact: true });
const response = (page, step = 1) => workspace(page).getByRole('region', { name: `Step ${step} response`, exact: true });
const responses = { 200: { description: 'Accepted', content: { 'application/json': { schema: { type: 'object' } } } } };
const nullable = (type, version = '3.1.0') => version.startsWith('3.0') ? { type, nullable: true } : { type: [type, 'null'] };

async function importSchema(page, origin, paths, version = '3.1.0') {
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  const document = { openapi: version, info: { title: 'Field presence browser fixture', version: '1.0.0' },
    servers: [{ url: origin }], paths };
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'field-presence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByRole('switch', { name: 'Enable Field presence browser fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
}

async function recordRequests(page, origin, result = { accepted: true }, pending = Promise.resolve()) {
  const requests = [];
  await page.route(`${origin}/field-presence/**`, async route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url(), body: request.postData(), contentType: request.headers()['content-type'] ?? null });
    await pending;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return requests;
}

Then('request field controls preserve drafts and send distinct omitted null and literal values', async function () {
  const page = this.page;
  await importSchema(page, this.baseURL, { '/field-presence/values': { post: {
    operationId: 'field-values', summary: 'Send field values', responses,
    parameters: [
      { name: 'absent', in: 'query', schema: { type: 'string', title: 'Query omitted' } },
      { name: 'nil', in: 'query', schema: { ...nullable('string'), title: 'Query null' } },
      { name: 'count', in: 'query', schema: { type: 'integer', title: 'Query count', minimum: 0, maximum: 4 } },
      { name: 'flag', in: 'query', schema: { type: 'boolean', title: 'Query flag' } },
    ],
    requestBody: { required: true, content: { 'application/json': { schema: {
      type: 'object', required: ['requiredText', 'requiredNullable'], additionalProperties: false,
      properties: {
        requiredText: { type: 'string', title: 'Required text', description: 'A label for this request.', minLength: 2, maxLength: 32 },
        requiredNullable: { ...nullable('string'), title: 'Required nullable' },
        note: { ...nullable('string'), title: 'Note' },
        literal: { ...nullable('string'), title: 'Literal text' },
        count: { type: 'number', title: 'Count', minimum: 0, maximum: 4 },
        enabled: { type: 'boolean', title: 'Enabled' },
        choice: { ...nullable('string'), title: 'Restricted choice', enum: ['allowed', 'other'] },
      },
    } } } },
  } } });
  await chooseCatalogOperation(page, 'Send field values');
  const run = workspace(page);
  const labels = ['Query omitted', 'Query null', 'Query count', 'Query flag', 'Required text', 'Required nullable',
    'Note', 'Literal text', 'Count', 'Enabled', 'Restricted choice'];
  for (const label of labels) {
    await expect(information(page, label)).toBeVisible();
    assert.ok(await information(page, label).evaluate(element => element.tabIndex >= 0), `${label} information must be keyboard reachable.`);
  }
  await expect(omitted(page, 'Required text')).toHaveCount(0);
  await expect(nullValue(page, 'Required text')).toHaveCount(0);
  await expect(omitted(page, 'Required nullable')).toHaveCount(0);
  await expect(nullValue(page, 'Restricted choice')).toHaveCount(0);

  await fillField(page, 'Required text', 'Request label');
  await (await field(page, 'Required text')).press('Tab');
  const help = information(page, 'Required text');
  await expect(help).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  const details = run.locator('.operation-field').filter({ has: page.getByRole('button', { name: 'About Required text', exact: true }) }).locator('.field-details');
  await expect(details).toContainText('A label for this request.');
  for (const [name, value] of [['Type', 'string'], ['Required', 'Yes'], ['Minimum length', '2'], ['Maximum length', '32']])
    await expect(details.locator('dl > div').filter({ has: page.getByText(name, { exact: true }) }).locator('dd')).toHaveText(value);
  await page.keyboard.press('Space');
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await information(page, 'Restricted choice').click();
  const enumDetails = run.locator('.operation-field').filter({ has: page.getByRole('button', { name: 'About Restricted choice', exact: true }) }).locator('.field-details');
  await expect(enumDetails).toContainText('Allowed values');
  await expect(enumDetails).toContainText('"allowed", "other"');
  await information(page, 'Restricted choice').click();

  await expect(omitted(page, 'Note')).toBeChecked();
  await expect(await field(page, 'Note')).toBeDisabled();
  await includeField(page, 'Note');
  const note = await field(page, 'Note');
  await note.fill('Keep this draft');
  await note.press('Tab');
  await expect(omitted(page, 'Note')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(omitted(page, 'Note')).toBeChecked();
  await expect(note).toBeDisabled();
  await expect(note).toHaveValue('Keep this draft');
  await expect(nullValue(page, 'Note')).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(note).toBeEnabled();
  await expect(note).toHaveValue('Keep this draft');
  await page.keyboard.press('Tab');
  await expect(nullValue(page, 'Note')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(nullValue(page, 'Note')).toBeChecked();
  await expect(note).toBeDisabled();
  await expect(note).toHaveValue('Keep this draft');
  await omitted(page, 'Note').check();
  await expect(nullValue(page, 'Note')).toBeDisabled();
  await omitted(page, 'Note').uncheck();
  await expect(nullValue(page, 'Note')).toBeChecked();
  await nullValue(page, 'Note').uncheck();
  await expect(note).toBeEnabled();
  await expect(note).toHaveValue('Keep this draft');
  await omitted(page, 'Note').check();

  await nullValue(page, 'Required nullable').check();
  await fillField(page, 'Literal text', 'null');
  await fillField(page, 'Count', '0');
  await fillField(page, 'Enabled', 'false');
  await fillField(page, 'Restricted choice', 'allowed');
  await fillField(page, 'Query omitted', 'Do not transmit');
  await omitted(page, 'Query omitted').check();
  await includeField(page, 'Query null');
  await nullValue(page, 'Query null').check();
  await fillField(page, 'Query count', '0');
  await fillField(page, 'Query flag', 'false');

  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const requests = await recordRequests(page, this.baseURL, { accepted: true }, pending);
  try {
    await executeOperation(page);
    await expect.poll(() => requests.length).toBe(1);
    for (const toggle of await run.getByRole('checkbox').all()) await expect(toggle).toBeDisabled();
    await expect(await field(page, 'Literal text')).toBeDisabled();
  } finally { release(); }
  await expect(response(page)).toContainText('accepted');
  for (const toggle of await run.getByRole('checkbox').all()) await expect(toggle).toBeDisabled();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(new URL(requests[0].url).pathname, '/field-presence/values');
  assert.deepEqual([...new URL(requests[0].url).searchParams], [['nil', 'null'], ['count', '0'], ['flag', 'false']]);
  assert.equal(requests[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(requests[0].body), { requiredText: 'Request label', requiredNullable: null,
    literal: 'null', count: 0, enabled: false, choice: 'allowed' });
});

Then('an OpenAPI {string} optional body sends omission and null distinctly', async function (version) {
  const page = this.page;
  await importSchema(page, this.baseURL, { '/field-presence/body': { post: {
    operationId: 'optional-body', summary: 'Send optional body', responses,
    requestBody: { content: { 'application/json': { schema: { ...nullable('string', version), title: 'Optional payload' } } } },
  } } }, version);
  const requests = await recordRequests(page, this.baseURL);
  await chooseCatalogOperation(page, 'Send optional body');
  await expect(omitted(page, 'Optional payload')).toBeChecked();
  await includeField(page, 'Optional payload');
  const editor = await field(page, 'Optional payload');
  await editor.fill('Whole body draft');
  await omitted(page, 'Optional payload').check();
  await expect(editor).toBeDisabled();
  await omitted(page, 'Optional payload').uncheck();
  await expect(editor).toHaveValue('Whole body draft');
  await omitted(page, 'Optional payload').check();
  await executeOperation(page);
  await expect(response(page)).toContainText('accepted');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, null);
  assert.equal(requests[0].contentType, null);

  await restartRun(page);
  await includeField(page, 'Optional payload');
  await nullValue(page, 'Optional payload').check();
  await expect(editor).toBeDisabled();
  await executeOperation(page);
  await expect(response(page)).toContainText('accepted');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body, 'null');
  assert.equal(requests[1].contentType, 'application/json');
});

Then('a connected nullable input stays locked and sends the upstream null', async function () {
  const page = this.page;
  await importSchema(page, this.baseURL, {
    '/field-presence/source': { get: { operationId: 'read-null', summary: 'Read nullable result', responses: {
      200: { description: 'A nullable value', content: { 'application/json': { schema: { type: 'object', properties: {
        value: { ...nullable('string'), title: 'Mapped value' },
      } } } } },
    } } },
    '/field-presence/target': { post: { operationId: 'send-connected', summary: 'Send connected value', responses,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
        value: { ...nullable('string'), title: 'Mapped value' },
      } } } } },
    } },
  });
  const requests = await recordRequests(page, this.baseURL, { value: null });
  await chooseCatalogOperation(page, 'Read nullable result');
  await quitRun(page);
  await chooseCatalogOperation(page, 'Send connected value', 'workflow');
  const includesBoth = doc => ['Read nullable result', 'Send connected value'].every(name =>
    doc.nodes.some(node => node.type === 'operation' && node.data.name === name));
  await expect.poll(async () => (await storedWorkflows(page)).filter(includesBoth).length).toBe(1);
  const document = (await storedWorkflows(page)).find(includesBoth);
  const endpoint = (operation, direction) => {
    const owner = document.nodes.find(node => node.type === 'operation' && node.data.name === operation);
    const panel = document.nodes.find(node => node.type === 'data' && node.data.ownerId === owner.id
      && node.data.direction === direction && node.data.fields.some(item => item.label === 'Mapped value'));
    assert.ok(panel, `${operation} must expose its mapped ${direction} field.`);
    return { node: panel.id, handle: panel.data.fields.find(item => item.label === 'Mapped value').id };
  };
  const source = endpoint('Read nullable result', 'outputs');
  const target = endpoint('Send connected value', 'inputs');
  document.edges.push({ id: 'nullable-mapping', kind: 'mapping', source: source.node, sourceHandle: source.handle,
    target: target.node, targetHandle: target.handle });
  const { revision } = await repository(page, 'load', document.id);
  await repository(page, 'save', document, revision);
  await page.reload();
  await setMode(page, 'workflow');
  await workflowAction(page, 'Run');
  await expect(workspace(page).getByRole('heading', { name: '1. Read nullable result', exact: true })).toBeVisible();
  await executeOperation(page);
  await workspace(page).getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: '2. Send connected value', exact: true })).toBeVisible();
  await expect(await field(page, 'Mapped value')).toBeDisabled();
  await expect(omitted(page, 'Mapped value')).toBeDisabled();
  await expect(omitted(page, 'Mapped value')).not.toBeChecked();
  await expect(nullValue(page, 'Mapped value')).toBeChecked();
  await expect(nullValue(page, 'Mapped value')).toBeDisabled();
  await expect(workspace(page).getByText('Connected from workflow', { exact: true })).toBeVisible();
  await executeOperation(page);
  await expect(response(page, 2)).toContainText('HTTP 200');
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).pathname, '/field-presence/target');
  assert.deepEqual(JSON.parse(requests[1].body), { value: null });
});
