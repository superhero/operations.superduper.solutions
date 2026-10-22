// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { connections, readExport, setMode, workflow } from './workspace.fixture.mjs';
import { repository } from './workflow-storage.fixture.mjs';

const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id="single-${id}"]`);
const port = (page, id, handle, type) => node(page, id).locator(handle === null
  ? `.svelte-flow__handle.${type}` : `.svelte-flow__handle[data-handleid="${handle}"]`);
const source = (page, id = 'source-b', legacy = false) => port(page, id, legacy ? null : 'result', 'source');
const target = (page, handle = 'value') => port(page, 'target', handle, 'target');
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
const cast = (id, x, y) => ({ id: `single-${id}`, type: 'cast', position: { x, y }, data: { targetType: 'Text' } });
const operation = (id, x, y) => ({ id: `single-${id}`, type: 'operation', position: { x, y },
  data: { operationId: 'demo:listProjects', name: id, description: '', method: 'GET', path: '/projects' } });
const field = (id, type = 'Text') => ({ id, label: id, type, required: false, description: '', connectable: true });
const mapping = (id, source, target = 'target', targetHandle = 'value', sourceHandle = 'result') => ({
  id, kind: 'mapping', source: `single-${source}`, sourceHandle, target: `single-${target}`, targetHandle,
});
const documentFor = (nodes, edges) => ({ version: 3, id: 'single-input-review', name: 'Single incoming connection review', description: '',
  nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false });

async function importGraph(world, document) {
  const page = world.page;
  await page.setViewportSize({ width: 1800, height: 1200 });
  await setMode(page, 'workflow');
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'single-input.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(node(page, 'target')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await saved(page);
  world.singleBaseline = (await readExport(page)).document;
  world.singleHistory = await repository(page, 'history', world.singleBaseline.id);
}

export async function center(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Connection gestures require a measured visible port or field.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function gesture(page, from, to, mode = 'drag', beforeRelease) {
  const start = await center(from), end = await center(to);
  await expect(from).toHaveClass(/\bconnectablestart\b/);
  // Native pointer events also exercise aria-disabled SVG handles: Playwright's
  // locator.click intentionally refuses elements marked aria-disabled.
  if (mode === 'click') {
    await page.mouse.click(start.x, start.y);
    await page.mouse.click(end.x, end.y);
  } else {
    await page.mouse.move(start.x, start.y);
    const hit = await from.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return { matches: hit === element || element.contains(hit), tag: hit?.outerHTML.slice(0, 300) };
    }, start);
    assert.equal(hit.matches, true, `The drag must begin on the actual source handle: ${hit.tag}`);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y, { steps: 3 });
    await expect(workflow(page).locator('.svelte-flow__connection')).toHaveCount(1);
    await page.mouse.move(end.x, end.y, { steps: 10 });
    if (beforeRelease) await beforeRelease();
    await page.mouse.up();
  }
}

async function expectLocked(locator, locked) {
  await expect(locator).toHaveAttribute('aria-disabled', String(locked));
  if (locked) await expect(locator).not.toHaveClass(/\bconnectableend\b/);
  else await expect(locator).toHaveClass(/\bconnectableend\b/);
}

async function removeConnection(page, id) {
  const edge = workflow(page).locator(`.svelte-flow__edge[data-id="${id}"]`);
  await edge.focus();
  await page.keyboard.press('Enter');
  await expect(edge).toHaveClass(/\bselected\b/);
  await page.keyboard.press('Delete');
  await expect(edge).toHaveCount(0);
  await saved(page);
}

async function assertRejected(world, from, to, mode = 'drag') {
  const page = world.page, before = (await readExport(page)).document;
  await gesture(page, from, to, mode);
  await page.keyboard.press('Escape');
  await expect(workflow(page).locator('.workflow-connection-preview, .svelte-flow__connection')).toHaveCount(0);
  assert.deepEqual((await readExport(page)).document.edges, before.edges,
    `An occupied input must reject a different source through a ${mode} gesture.`);
}

Given('a workflow with an occupied data field and separate free fields', async function () {
  const data = (id, ownerId, direction, x, y, fields) => ({ id: `single-${id}`, type: 'data', position: { x, y },
    data: { ownerId: `single-${ownerId}`, direction, label: id, fields } });
  const branch = (child, parent, handle, input = true) => ({ id: `schema:single-${child}`, kind: 'schema',
    source: `single-${input ? child : parent}`, target: `single-${input ? parent : child}`,
    sourceHandle: input ? 'value' : handle, targetHandle: input ? handle : 'value' });
  const nodes = [cast('source-a', 80, 140), cast('source-b', 80, 420), operation('owner', 1250, 300),
    data('target', 'owner', 'inputs', 900, 140, [field('occupied')]),
    data('free-fields', 'owner', 'inputs', 900, 500, [field('first'), field('second'), field('object', 'Object')]),
    data('object-child', 'owner', 'inputs', 600, 750, [field('code')]), operation('object-owner', 80, 850),
    data('object-source', 'object-owner', 'outputs', 430, 850, [field('payload', 'Object')])];
  await importGraph(this, documentFor(nodes, [mapping('single-original', 'source-a', 'target', 'occupied'),
    branch('target', 'owner', 'schema:single-target'), branch('free-fields', 'owner', 'schema:single-free-fields'),
    branch('object-child', 'free-fields', 'object'), branch('object-source', 'object-owner', 'schema:single-object-source', false)]));
});

Then('another source cannot connect by dragging clicking or dropping on the occupied field', async function () {
  const page = this.page, occupied = target(page, 'occupied');
  await expectLocked(occupied, true);
  for (const mode of ['drag', 'click']) await assertRejected(this, source(page), occupied, mode);
  const row = node(page, 'target').locator('.data-field .field-name');
  assert.ok((await center(row)).x > (await center(occupied)).x + 10, 'The body drop must miss the native handle hit area.');
  await assertRejected(this, source(page), row, 'body drop');
  await expect(connections(page)).toHaveCount(1);
  assert.deepEqual(await repository(page, 'history', this.singleBaseline.id), this.singleHistory,
    'Rejected gestures must not create workflow history revisions.');
});

Then('removing its mapping unlocks the field while output fanout and schema-backed fields remain available', async function () {
  const page = this.page, occupied = target(page, 'occupied');
  await removeConnection(page, 'single-original');
  await expectLocked(occupied, false);
  await gesture(page, source(page), occupied, 'click');
  await expect(connections(page)).toHaveCount(1);
  await expectLocked(occupied, true);
  for (const [index, handle] of ['first', 'second'].entries()) {
    const input = port(page, 'free-fields', handle, 'target');
    await expectLocked(input, false);
    await expect(source(page, 'source-a')).toHaveClass(/\bconnectablestart\b/);
    await gesture(page, source(page, 'source-a'), input, 'click');
    await expect(connections(page)).toHaveCount(index + 2);
    await expectLocked(input, true);
  }
  const object = port(page, 'free-fields', 'object', 'target');
  await expectLocked(object, false);
  await gesture(page, port(page, 'object-source', 'payload', 'source'), object);
  await expect(connections(page)).toHaveCount(4);
  await expectLocked(object, true);
  await saved(page);
  const document = (await readExport(page)).document;
  const actual = document.edges.filter(edge => edge.kind === 'mapping').map(({ id, ...edge }) => edge);
  const expected = [mapping('', 'source-b', 'target', 'occupied'), mapping('', 'source-a', 'free-fields', 'first'),
    mapping('', 'source-a', 'free-fields', 'second'), mapping('', 'object-source', 'free-fields', 'object', 'payload')]
    .map(({ id, ...edge }) => edge);
  assert.deepEqual(actual, expected, 'One output may fan out while each distinct target handle owns only one mapping.');
  assert.deepEqual(document.edges.filter(edge => edge.kind === 'schema'), this.singleBaseline.edges.filter(edge => edge.kind === 'schema'),
    'A structural schema attachment must neither occupy the Object field nor be replaced by its new mapping.');
});

function simpleFixture(kind, fanIn = false) {
  const legacy = kind === 'legacy', handle = kind === 'switch operand' ? 'gate-value:single-gate' : legacy ? null : 'value';
  const sources = [legacy ? operation : cast].flatMap(create => [create('source-a', 80, 140), create('source-b', 80, 430), create('source-c', 80, 700)]);
  const target = legacy ? operation('target', 800, 330) : kind.startsWith('switch')
    ? { id: 'single-target', type: 'switch', position: { x: 800, y: 330 }, data: { gates: [{ id: 'single-gate', operator: kind === 'switch' ? 'is_set' : '==', value: '' }] } }
    : cast('target', 800, 330);
  const edge = (id, source) => legacy ? { id, source: `single-${source}`, target: 'single-target' } : mapping(id, source, 'target', handle);
  return { document: documentFor([...sources, target], [edge('single-original', 'source-a'),
    ...(kind === 'switch operand' ? [mapping('single-main-input', 'source-a')] : []),
    ...(fanIn ? [edge('single-second', 'source-b')] : [])]),
    handle, legacy };
}

Given(/^an occupied (cast|switch|switch operand|legacy) workflow input$/, async function (kind) {
  const fixture = simpleFixture(kind);
  this.singleHandle = fixture.handle;
  this.singleLegacy = fixture.legacy;
  await importGraph(this, fixture.document);
});

Then('its existing connection blocks another source until it is deleted', async function () {
  const page = this.page, input = target(page, this.singleHandle), alternative = source(page, 'source-b', this.singleLegacy);
  await expectLocked(input, true);
  await expect(input).not.toHaveClass(/\bconnectablestart\b/);
  await assertRejected(this, alternative, input);
  await removeConnection(page, 'single-original');
  await expectLocked(input, false);
  if (this.singleLegacy) await expect(input).toHaveClass(/\bconnectablestart\b/);
  await gesture(page, alternative, input, 'click');
  await expect(connections(page)).toHaveCount(this.singleBaseline.edges.length);
  await expectLocked(input, true);
  await expect(input).not.toHaveClass(/\bconnectablestart\b/);
  await saved(page);
  const document = (await readExport(page)).document;
  const added = document.edges.find(edge => edge.source === 'single-source-b');
  assert.equal(added?.target, 'single-target');
  assert.equal(added?.targetHandle ?? null, this.singleHandle);
  if (this.singleLegacy) {
    await removeConnection(page, added.id);
    await expectLocked(input, false);
    await expect(input).toHaveClass(/\bconnectablestart\b/);
    await expect(alternative).toHaveClass(/\bconnectableend\b/);
    await gesture(page, input, alternative);
    await expect(connections(page)).toHaveCount(1);
    await expectLocked(input, true);
    await expect(input).not.toHaveClass(/\bconnectablestart\b/);
    await saved(page);
    const reversed = (await readExport(page)).document.edges[0];
    assert.equal(reversed.source, 'single-source-b', 'A reverse drag must retain the output as its source.');
    assert.equal(reversed.target, 'single-target', 'A reverse drag must retain the input as its target.');
    assert.equal(reversed.sourceHandle ?? null, null);
    assert.equal(reversed.targetHandle ?? null, null);
  }
});

Given('a saved cast input with two existing incoming connections', async function () {
  await importGraph(this, simpleFixture('cast', true).document);
  assert.equal(this.singleBaseline.edges.length, 2, 'Import must preserve existing multiple-input documents.');
});

Then('it stays locked until both old connections are removed and accepts a new source afterwards', async function () {
  const page = this.page, input = target(page), third = source(page, 'source-c');
  await expectLocked(input, true);
  await assertRejected(this, third, input);
  await removeConnection(page, 'single-original');
  await expect(connections(page)).toHaveCount(1);
  await expectLocked(input, true);
  await assertRejected(this, third, input, 'click');
  await removeConnection(page, 'single-second');
  await expectLocked(input, false);
  await gesture(page, third, input);
  await expect(connections(page)).toHaveCount(1);
  await saved(page);
  const document = (await readExport(page)).document;
  assert.equal(document.edges[0].source, 'single-source-c');
});
