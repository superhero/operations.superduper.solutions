// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setMode, readExport, workflow } from './workspace.steps.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';
import { defaultProcessingData } from '../../src/lib/workflow-processing.ts';
import { parseWorkflowFile } from '../../src/lib/workflow-file.ts';
import { operations } from '../../src/lib/catalog.ts';
import { catalogForOperation } from '../../src/lib/catalog-registry.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';

const configuration = (kind, operation, parameters = {}) => {
  const value = defaultProcessingData(kind, operation);
  return { ...value, parameters: { ...value.parameters, ...parameters } };
};
const processor = (type, operation, parameters = {}, x = 500) => ({ id: type, type, position: { x, y: 300 }, data: configuration(type, operation, parameters) });
const source = value => ({ id: 'source', type: 'file', position: { x: 100, y: 300 }, data: { file: parseWorkflowFile('input.json', JSON.stringify(value)) } });
const connection = (source, target, sourceHandle = 'result', targetHandle = 'value') => ({ id: `${source}:${sourceHandle}:${target}:${targetHandle}`, kind: 'mapping', source, target, sourceHandle, targetHandle });
const document = (nodes, edges) => ({ version: 3, id: 'processing-browser', name: 'Processing browser', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: true, dashed: false });
const saved = async page => {
  await workflow(page).focus();
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
};
const panel = page => page.getByRole('dialog', { name: 'Run workflow: Processing browser', exact: true });
async function choose(page, node, label, option) {
  await node.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

Then('Transform Filter and Assert can be configured undone exported and restored', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Transform', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const transform = workflow(page).locator('[data-processing-kind="transform"]');
  const filter = workflow(page).locator('[data-processing-kind="filter"]');
  const assertion = workflow(page).locator('[data-processing-kind="assert"]');
  await choose(page, transform, 'Transform operation', 'Hash SHA-256');
  await expect(transform.locator('.utility-title strong')).toHaveText('Hash SHA-256');
  await saved(page);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await choose(page, filter, 'Filter operation', 'Substring');
  await filter.getByLabel('Start (inclusive)', { exact: true }).fill('1');
  await filter.getByLabel('End (exclusive)', { exact: true }).fill('3');
  await saved(page);
  // Expanding a placed card preserves its position. Move it as a user would
  // before adding its neighbour, then verify the saved layout after reload.
  if (page.viewportSize().width >= 1000) {
    const title = await filter.locator('.utility-title').boundingBox();
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
    await page.mouse.down();
    await page.mouse.move(title.x + title.width / 2 - 340, title.y + title.height / 2, { steps: 8 });
    await page.mouse.up();
    await saved(page);
  }
  await page.getByRole('button', { name: 'Assert', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await expect(assertion.getByLabel('Expected value (JSON or text)', { exact: true })).toBeDisabled();
  await choose(page, assertion, 'Condition', 'Equals');
  await expect(assertion.getByLabel('Expected value (JSON or text)', { exact: true })).toBeEnabled();
  await saved(page);
  await assertion.getByLabel('Expected value (JSON or text)', { exact: true }).fill('abc');
  await saved(page);
  let exported = (await readExport(page)).document;
  assert.deepEqual(exported.nodes.filter(node => ['transform', 'filter', 'assert'].includes(node.type)).map(node => node.type).sort(), ['assert', 'filter', 'transform']);
  assert.equal(exported.nodes.find(node => node.type === 'filter').data.parameters.end, '3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(assertion.getByLabel('Expected value (JSON or text)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(assertion.getByLabel('Expected value (JSON or text)', { exact: true })).toHaveValue('abc');
  await saved(page);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(workflow(page).locator('[data-processing-kind]')).toHaveCount(3);
  exported = (await readExport(page)).document;
  assert.equal(exported.nodes.find(node => node.type === 'assert').data.parameters.expected, 'abc');
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const positions = exported.nodes.map(node => ({ id: node.id, position: node.position }));
  assert.deepEqual(positions, (await readExport(page)).document.nodes.map(node => ({ id: node.id, position: node.position })));
  await mkdir(this.artifactDirectory, { recursive: true });
  await workflow(page).screenshot({ path: `${this.artifactDirectory}/processing-nodes.png` });
});

Then('a file filter transform and assertion complete without an HTTP operation or leaked worker', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    window.__processingWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (options?.name === 'workflow-processing') { this.record = { calls: 0, terminated: 0 }; window.__processingWorkers.push(this.record); }
      }
      postMessage(message, ...args) { if (this.record && message?.kind === 'request') this.record.calls++; return super.postMessage(message, ...args); }
      terminate() { if (this.record) this.record.terminated++; return super.terminate(); }
    };
  });
  await loadGraphFixture(page, document([source('  abc  '), processor('filter', 'trim', {}, 500), processor('transform', 'base64_encode', {}, 900),
    processor('assert', 'expect', { operator: 'equals', expected: 'YWJj' }, 1300)],
  [connection('source', 'filter', 'value'), connection('filter', 'transform'), connection('transform', 'assert')]));
  assert.equal(await page.evaluate(() => window.__processingWorkers.length), 0);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByText('Processing results (3)', { exact: true }).click();
  await expect(run.getByRole('region', { name: 'Encode Base64 result' })).toContainText('YWJj');
  await expect(run.getByText('Assert · Success', { exact: true })).toBeVisible();
  await expect(run.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__processingWorkers)).toEqual([{ calls: 3, terminated: 1 }]);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('the real vault worker checks a private transformation without returning its value', async function () {
  const result = await this.page.evaluate(async () => {
    const fixture = await import('/vault-storage-fixture.js');
    return fixture.checkProcessingAssertion();
  });
  assert.deepEqual(result, { matched: true, unmatched: false });
  assert.ok(!JSON.stringify(result).includes('private-processing-browser-canary'));
});

Then(/^an assertion with a (failure|success) connection proceeds with its original value or manual input$/, async function (output) {
  const page = this.page;
  await setMode(page, 'workflow');
  const operation = operations.find(operation => operation.id === 'demo:mockPlainText');
  const graph = createOperationGraph(operation, { x: 1000, y: 300 }, 'target', catalogForOperation(operation.id).document);
  const input = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs' && node.data.fields.some(field => field.connectable && field.type === 'Text'));
  const handle = input.data.fields.find(field => field.connectable && field.type === 'Text').id;
  let sent;
  await page.route('https://example.com/**', async route => {
    sent = route.request().postData();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await loadGraphFixture(page, document([source('original'), processor('assert', 'expect', { operator: 'equals', expected: 'other' }), ...graph.nodes],
    [connection('source', 'assert', 'value'), connection('assert', input.id, output, handle), ...graph.edges]));
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page), field = run.locator('form').getByRole('textbox').first();
  await expect(field).toBeVisible();
  if (output === 'failure') { await expect(field).toHaveValue('original'); await expect(field).not.toBeEditable(); }
  else { await expect(field).toBeEditable(); await field.fill('Manual fallback'); }
  await expect(run.getByRole('alert')).toHaveCount(0);
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByText('Operation completed.', { exact: true })).toBeVisible();
  assert.equal(sent, output === 'failure' ? 'original' : 'Manual fallback');
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
});
