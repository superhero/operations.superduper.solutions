// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { operations } from '../../src/lib/catalog.ts';
import { createOperationGraph, removeGraphSelection } from '../../src/lib/workflow-graph.ts';
import { repository, storageKey } from './workflow-storage.fixture.mjs';
import { readExport, setMode, workflow } from './workspace.steps.mjs';

const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id=${JSON.stringify(id)}]`);
const selectedIds = page => workflow(page).locator('.svelte-flow__node.selected')
  .evaluateAll(nodes => nodes.map(node => node.dataset.id).sort());
const selectedEdgeIds = page => workflow(page).locator('.svelte-flow__edge.selected')
  .evaluateAll(edges => edges.map(edge => edge.dataset.id).sort());
const selectionRectangle = page => workflow(page).locator('.svelte-flow__selection, .svelte-flow__selection-wrapper');
const panel = (graph, label) => graph.nodes.find(node => node.type === 'data' && node.data.label === label);
const textObject = title => ({ title, type: 'object', properties: { code: { type: 'string' } } });
const nestedSchema = prefix => ({ type: 'object', properties: {
  branch: { title: `${prefix} branch`, type: 'object', properties: {
    code: { type: 'string' }, leaf: textObject(`${prefix} leaf`), hidden: textObject(`Hidden ${prefix.toLowerCase()}`),
  } },
  sibling: textObject(`${prefix} sibling`),
} });

async function boxSelect(page, ids) {
  const boxes = await Promise.all(ids.map(id => node(page, id).boundingBox()));
  assert.ok(boxes.every(Boolean), 'The operations must have visible bounds for box selection.');
  await page.keyboard.down('Shift');
  // At Fit View, adjacent schema panels can be less than eight screen pixels
  // from an operation. Keep the box's horizontal padding inside that gap.
  await page.mouse.move(Math.min(...boxes.map(box => box.x)) - 2, Math.min(...boxes.map(box => box.y)) - 8);
  await page.mouse.down();
  await page.mouse.move(Math.max(...boxes.map(box => box.x + box.width)) + 2,
    Math.max(...boxes.map(box => box.y + box.height)) + 8, { steps: 8 });
  await expect(workflow(page).locator('.svelte-flow__selection')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => selectedIds(page)).toEqual([...ids].sort());
  await expect(selectionRectangle(page)).toHaveCount(0);
  return boxes;
}

function operationGraph(id, position, nested) {
  const operation = { ...operations.find(operation => operation.id === 'demo:createTask'), name: id };
  const schema = { paths: { [operation.path]: { post: {
    requestBody: { content: { 'application/json': { schema: nested ? nestedSchema('Input') : textObject('Input') } } },
    responses: { 200: { content: { 'application/json': { schema: nested ? nestedSchema('Output') : textObject('Output') } } } },
  } } } };
  return createOperationGraph(operation, position, id, schema);
}

Given('nested workflow input and output branches mapped to another operation', async function () {
  const primary = operationGraph('Selection owner', { x: 1050, y: 200 }, true);
  const other = operationGraph('Other operation', { x: 1050, y: 800 }, false);
  const mapping = (id, source, target) => ({ id, kind: 'mapping', source: source.id, target: target.id,
    sourceHandle: source.data.fields.find(field => field.label === 'code').id,
    targetHandle: target.data.fields.find(field => field.label === 'code').id });
  const graph = removeGraphSelection({ nodes: [panel(primary, 'Hidden input'), panel(primary, 'Hidden output')], edges: [] },
    [...primary.nodes, ...other.nodes], [...primary.edges, ...other.edges,
      mapping('mapped-output', panel(primary, 'Output branch'), panel(other, 'Request body')),
      mapping('mapped-input', panel(other, 'Response · 200'), panel(primary, 'Input branch'))]);
  const document = { version: 3, id: 'branch-selection', name: 'Branch selection review', description: '', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false };
  await this.page.evaluate(({ key, document }) => localStorage.setItem(key, JSON.stringify([document])), { key: storageKey, document });
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await this.page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await expect(this.page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  this.selectionIds = Object.fromEntries(primary.nodes.map(node => [node.type === 'data' ? node.data.label : node.id, node.id]));
  this.selectionBaseline = (await readExport(this.page)).document;
  this.selectionRepository = await repository(this.page, 'inspect', document.id);
  for (const label of ['Hidden input', 'Hidden output']) await expect(node(this.page, this.selectionIds[label])).toHaveCount(0);
});

Then('Shift-drag rectangles retain prior nodes and edges while adding only their current hits', async function () {
  const page = this.page;
  const edgeId = `schema:${this.selectionIds['Output leaf']}`;
  const edge = workflow(page).locator(`.svelte-flow__edge[data-id=${JSON.stringify(edgeId)}]`);
  await edge.focus();
  await page.keyboard.press('Enter');
  await node(page, 'Selection owner').locator('.operation-title-row strong').click({ modifiers: ['Control'] });
  let retainedNodes = ['Selection owner'];
  let retainedEdges = [edgeId];
  const expectSelection = async (nodes, edges) => {
    await expect.poll(() => selectedIds(page)).toEqual([...nodes].sort());
    await expect.poll(() => selectedEdgeIds(page)).toEqual([...edges].sort());
  };
  await expectSelection(retainedNodes, retainedEdges);
  for (const [id, shrink] of [['Other operation', false], ['Other operation', false], [this.selectionIds['Input leaf'], true]]) {
    if (id === 'Other operation' && retainedNodes.includes(id)) {
      const [first, last] = await Promise.all(retainedNodes.map(id => node(page, id).boundingBox()));
      assert.ok(first && last, 'The selected nodes must remain visible.');
      const gap = { x: first.x + first.width / 2, y: (first.y + first.height + last.y) / 2 };
      assert.equal(await page.evaluate(({ x, y }) => {
        const elements = document.elementsFromPoint(x, y);
        return !elements.some(element => element.closest('.svelte-flow__node, .svelte-flow__selection-wrapper'));
      }, gap), true, 'The rectangle must start in the empty gap between selected nodes.');
      await page.keyboard.down('Shift');
      await page.mouse.move(gap.x, gap.y);
      await page.mouse.down();
      await page.mouse.move(gap.x + 12, gap.y + 12, { steps: 4 });
      await expect(workflow(page).locator('.svelte-flow__selection')).toBeVisible();
      await expectSelection(retainedNodes, retainedEdges);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await expectSelection(retainedNodes, retainedEdges);
      await expect(selectionRectangle(page)).toHaveCount(0);
    }
    const box = await node(page, id).boundingBox();
    assert.ok(box, 'The rectangle target must have visible bounds.');
    const expectedNodes = [...new Set([...retainedNodes, id])];
    const expectedEdges = [...new Set([...retainedEdges, ...this.selectionBaseline.edges
      .filter(edge => !edge.hidden && (edge.source === id || edge.target === id)).map(edge => edge.id)])];
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x - 8, box.y - 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 8, box.y + box.height + 8, { steps: 8 });
    await expect(workflow(page).locator('.svelte-flow__selection')).toBeVisible();
    await expectSelection(expectedNodes, expectedEdges);
    if (shrink) {
      await page.mouse.move(box.x - 5, box.y - 5, { steps: 8 });
      await expectSelection(retainedNodes, retainedEdges);
    } else {
      retainedNodes = expectedNodes;
      retainedEdges = expectedEdges;
    }
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expectSelection(retainedNodes, retainedEdges);
    await expect(selectionRectangle(page)).toHaveCount(0);
  }
});

Then('Shift-click toggles operation headers data headers and fields while Control-click still works', async function () {
  const page = this.page;
  const expected = new Set(['Other operation']);
  await boxSelect(page, [...expected]);
  const gestures = [
    ['Shift', 'Selection owner', '.operation-title-row strong'],
    ['Shift', 'Input branch', '.data-title strong'],
    ['Shift', 'Output branch', '.field-name'],
    ['Shift', 'Selection owner', '.operation-title-row strong'],
    ['Shift', 'Input branch', '.field-name'],
    ['Shift', 'Output branch', '.data-title strong'],
    ['Control', 'Selection owner', '.operation-title-row strong'],
    ['Control', 'Input branch', '.field-name'],
    ['Control', 'Selection owner', '.operation-title-row strong'],
    ['Control', 'Input branch', '.data-title strong'],
  ];
  for (const [modifier, label, selector] of gestures) {
    const id = this.selectionIds[label];
    await node(page, id).locator(selector).first().click({ modifiers: [modifier] });
    if (expected.has(id)) expected.delete(id);
    else expected.add(id);
    await expect.poll(() => selectedIds(page)).toEqual([...expected].sort());
  }
});

Then('double-clicking owners and data panels replaces selection with their visible branches', async function () {
  const page = this.page;
  const ids = this.selectionIds;
  const branches = [
    ['Selection owner', ['Selection owner', 'Request body', 'Input branch', 'Input leaf', 'Input sibling',
      'Response · 200', 'Output branch', 'Output leaf', 'Output sibling']],
    ['Response · 200', ['Response · 200', 'Output branch', 'Output leaf', 'Output sibling']],
    ['Output branch', ['Output branch', 'Output leaf']],
    ['Output leaf', ['Output leaf']],
    ['Request body', ['Request body', 'Input branch', 'Input leaf', 'Input sibling']],
    ['Input branch', ['Input branch', 'Input leaf']],
    ['Input leaf', ['Input leaf']],
  ];
  const edge = workflow(page).locator('.svelte-flow__edge[data-id="mapped-output"]');
  await edge.focus();
  await page.keyboard.press('Enter');
  await expect(edge).toHaveClass(/selected/);
  await node(page, 'Other operation').locator('.operation-title-row strong').click({ modifiers: ['Control'] });
  await expect(node(page, 'Other operation')).toHaveClass(/selected/);
  await expect(edge).toHaveClass(/selected/);
  for (const [label, expected] of branches) {
    await node(page, ids[label]).locator(label === 'Selection owner' ? '.operation-title-row strong' : '.data-title strong').dblclick();
    await expect.poll(() => selectedIds(page)).toEqual(expected.map(label => ids[label]).sort());
    await expect(workflow(page).locator('.svelte-flow__edge.selected')).toHaveCount(0);
  }
});

Then('I can clear boxed workflow nodes using {string}', async function (gesture) {
  const page = this.page;
  const single = gesture === 'Shift-click the only node';
  const boxes = await boxSelect(page, single ? ['Other operation'] : ['Selection owner', 'Other operation']);
  const overlay = workflow(page).locator('.svelte-flow__selection-wrapper');
  await expect(overlay).toHaveCount(0);
  if (single) {
    await node(page, 'Other operation').focus();
    await expect(node(page, 'Other operation')).toBeFocused();
  }
  if (single || gesture === 'click an empty selected gap') {
    const point = single ? { x: boxes[0].x + boxes[0].width / 2, y: boxes[0].y + boxes[0].height / 2 }
      : { x: boxes[0].x + boxes[0].width / 2, y: (boxes[0].y + boxes[0].height + boxes[1].y) / 2 };
    const hit = await page.evaluate(({ x, y }) => {
      const elements = document.elementsFromPoint(x, y);
      return { overlay: Boolean(elements[0]?.closest('.svelte-flow__selection-wrapper')),
        node: elements.some(element => element.closest('.svelte-flow__node')) };
    }, point);
    assert.equal(hit.overlay, false, 'No group rectangle should cover the pointer target.');
    assert.equal(hit.node, single, 'Only the node gesture should hit a node.');
    if (single) await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    if (single) await page.keyboard.up('Shift');
  } else {
    const target = gesture === 'Escape from canvas' ? workflow(page) : node(page, 'Other operation');
    await target.focus();
    await expect(target).toBeFocused();
    await page.keyboard.press('Escape');
  }
  await expect.poll(() => selectedIds(page), { timeout: 1000 }).toEqual([]);
  await expect(workflow(page).locator('.svelte-flow__edge.selected')).toHaveCount(0);
  await expect(overlay).toHaveCount(0);
  if (single) await expect(node(page, 'Other operation')).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toBeDisabled();
});

Then('branch selection preserves the saved workflow and its revision', async function () {
  assert.deepEqual((await readExport(this.page)).document, this.selectionBaseline, 'Selection must preserve graph content and viewport.');
  assert.deepEqual(await repository(this.page, 'inspect', this.selectionBaseline.id), this.selectionRepository,
    'Selection must preserve the saved document, Git revisions, and view preferences.');
  await expect(this.page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
});
