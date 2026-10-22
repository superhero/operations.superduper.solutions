// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { connections, readExport, setMode, workflow } from './workspace.fixture.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { center, gesture } from './workflow-single-input.steps.mjs';

const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id="types-${id}"]`);
const port = (page, id, handle = 'value') => node(page, id).locator(`.svelte-flow__handle[data-handleid="${handle}"]`);
const output = (page, type) => port(page, 'source', type.toLowerCase());
const input = (page, type) => port(page, type.toLowerCase(), 'field');
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
const field = (id, type) => ({ id, label: id, type, required: false, description: '', connectable: true });
const operation = (id, x, y) => ({ id: `types-${id}`, type: 'operation', position: { x, y },
  data: { operationId: 'demo:listProjects', name: id, description: '', method: 'GET', path: '/projects' } });
const data = (id, ownerId, direction, x, y, fields) => ({ id: `types-${id}`, type: 'data', position: { x, y },
  data: { ownerId: `types-${ownerId}`, direction, label: id, fields } });

Given('a workflow with typed scalar fields and conversion utilities', async function () {
  const page = this.page, types = ['Text', 'Integer', 'Number', 'Boolean'];
  const nodes = [operation('source-owner', 40, 220), operation('target-owner', 1640, 380),
    data('source', 'source-owner', 'outputs', 390, 180, types.map(type => field(type.toLowerCase(), type))),
    ...types.map((type, index) => data(type.toLowerCase(), 'target-owner', 'inputs', 1250, 70 + index * 235, [field('field', type)])),
    { id: 'types-cast', type: 'cast', position: { x: 790, y: 470 }, data: { targetType: 'Number' } },
    { id: 'types-switch', type: 'switch', position: { x: 790, y: 100 },
      data: { gates: [{ id: 'integer-gate', operator: 'is_set', value: '' }] } }];
  const edges = nodes.filter(item => item.type === 'data').map(item => ({
    id: `schema:${item.id}`, kind: 'schema',
    source: item.data.direction === 'inputs' ? item.id : item.data.ownerId,
    target: item.data.direction === 'inputs' ? item.data.ownerId : item.id,
    sourceHandle: item.data.direction === 'inputs' ? 'value' : `schema:${item.id}`,
    targetHandle: item.data.direction === 'inputs' ? `schema:${item.id}` : 'value',
  }));
  const document = { version: 3, id: 'connection-type-review', name: 'Connection type review', description: '', nodes, edges,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false };
  await page.setViewportSize({ width: 1900, height: 1200 });
  await setMode(page, 'workflow');
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'connection-types.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(node(page, 'boolean')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await saved(page);
  this.typeBaseline = (await readExport(page)).document;
  this.typeHistory = await repository(page, 'history', this.typeBaseline.id);
});

async function reject(world, from, to, mode = 'drag') {
  const page = world.page, before = (await readExport(page)).document.edges;
  const noPreview = () => expect(workflow(page).locator('.workflow-connection-preview')).toHaveCount(0);
  await gesture(page, from, to, mode, noPreview);
  await noPreview();
  await page.keyboard.press('Escape');
  await expect(workflow(page).locator('.svelte-flow__connection')).toHaveCount(0);
  assert.deepEqual((await readExport(page)).document.edges, before, `${mode} must reject incompatible port types.`);
}

Then('incompatible scalar mappings show no valid preview and reject drag click and body drops', async function () {
  const page = this.page;
  for (const [sourceType, targetType] of [['Text', 'Integer'], ['Integer', 'Boolean'], ['Number', 'Integer']]) {
    const from = output(page, sourceType), to = input(page, targetType);
    await expect(to).toHaveAttribute('aria-disabled', 'false');
    for (const mode of ['drag', 'click']) await reject(this, from, to, mode);
    const body = node(page, targetType.toLowerCase()).locator('.data-field .field-name');
    assert.ok((await center(body)).x > (await center(to)).x + 10, 'The drop must exercise panel snapping away from the handle.');
    await reject(this, from, body, 'body drop');
  }
  await expect(connections(page)).toHaveCount(0);
  assert.deepEqual(await repository(page, 'history', this.typeBaseline.id), this.typeHistory,
    'Rejected type mismatches must not create workflow revisions.');
});

async function connect(world, from, to, mode = 'drag') {
  const page = world.page, count = await connections(page).count();
  await gesture(page, from, to, mode);
  await expect(connections(page)).toHaveCount(count + 1);
  await expect(to).toHaveAttribute('aria-disabled', 'true');
  await saved(page);
}

Then('matching scalar fields and Integer to Number accept mappings with their original endpoints', async function () {
  const page = this.page;
  for (const [sourceType, targetType, mode] of [['Text', 'Text', 'click'], ['Integer', 'Integer', 'drag'],
    ['Boolean', 'Boolean', 'click'], ['Integer', 'Number', 'drag']]) {
    await connect(this, output(page, sourceType), input(page, targetType), mode);
  }
  const document = (await readExport(page)).document;
  assert.deepEqual(document.edges.filter(edge => edge.kind === 'mapping').map(edge =>
    [edge.source, edge.sourceHandle, edge.target, edge.targetHandle]), [
    ['types-source', 'text', 'types-text', 'field'], ['types-source', 'integer', 'types-integer', 'field'],
    ['types-source', 'boolean', 'types-boolean', 'field'], ['types-source', 'integer', 'types-number', 'field'],
  ]);
});

Then('a Cast accepts Text and exposes Number while a Switch keeps Integer on its output', async function () {
  const page = this.page;
  await connect(this, output(page, 'Text'), port(page, 'cast'), 'click');
  await reject(this, port(page, 'cast', 'result'), input(page, 'Integer'));
  await connect(this, port(page, 'cast', 'result'), input(page, 'Number'));
  await connect(this, output(page, 'Integer'), port(page, 'switch'));
  await reject(this, port(page, 'switch', 'integer-gate'), input(page, 'Boolean'), 'click');
  await connect(this, port(page, 'switch', 'integer-gate'), input(page, 'Integer'));
  const document = (await readExport(page)).document;
  assert.deepEqual(document.edges.filter(edge => edge.kind === 'mapping').map(edge =>
    [edge.source, edge.sourceHandle, edge.target, edge.targetHandle]), [
    ['types-source', 'text', 'types-cast', 'value'], ['types-cast', 'result', 'types-number', 'field'],
    ['types-source', 'integer', 'types-switch', 'value'], ['types-switch', 'integer-gate', 'types-integer', 'field'],
  ]);
});
