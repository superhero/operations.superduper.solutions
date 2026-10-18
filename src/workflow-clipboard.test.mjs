// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { operations } from './lib/catalog.ts';
import { createOperationGraph, createWorkflowGraph } from './lib/workflow-graph.ts';
import { validateWorkflowDocument } from './lib/workflow-document.ts';
import { copyWorkflowSelection, pasteWorkflowSelection } from './lib/workflow-clipboard.ts';
const document = graph => ({ version: 3, id: 'clipboard', name: 'Clipboard', ...graph,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: true });
function graph(id) {
  const operation = operations.find(operation => operation.id === 'demo:createTask');
  return createOperationGraph(operation, { x: 0, y: 0 }, id, { paths: { [operation.path]: { post: {
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { nested: { type: 'object', properties: { text: { type: 'string' } } } } } } } },
    responses: { 200: { content: { 'application/json': { schema: { type: 'string' } } } } }
  } } } });
}
Then('copying schema nodes includes their owners and preserves only internal connections', () => {
  const first = graph('first'), other = graph('other');
  const saved = document({ nodes: [...first.nodes, ...other.nodes], edges: [...first.edges, ...other.edges] });
  assert.equal(copyWorkflowSelection(saved, [], []), null);
  const copied = copyWorkflowSelection(saved, [first.nodes.find(node => node.type === 'data').id], []);
  assert.deepEqual(copied.nodes, first.nodes);
  assert.deepEqual(copied.edges, first.edges);
  validateWorkflowDocument(document(copied));
  const fromEdge = copyWorkflowSelection(saved, [], [first.edges[0].id]);
  assert.deepEqual(fromEdge, copied);
  copied.nodes[0].position.x = 1234;
  assert.equal(saved.nodes[0].position.x, 0);
});
Then('pasted graphs have fresh identities and translated routes without mutating the clipboard', () => {
  const original = graph('first');
  original.edges[0].manualRoute = [{ x: 10, y: 20 }, { x: 30, y: 20 }];
  const saved = document(original);
  const copied = copyWorkflowSelection(saved, ['first'], []);
  const before = structuredClone(copied);
  const pasted = pasteWorkflowSelection(copied);
  const again = pasteWorkflowSelection(copied, 64);
  validateWorkflowDocument(document({ nodes: [...saved.nodes, ...pasted.nodes, ...again.nodes], edges: [...saved.edges, ...pasted.edges, ...again.edges] }));
  assert.deepEqual(copied, before);
  assert.deepEqual(pasted.edges[0].manualRoute, [{ x: 42, y: 52 }, { x: 62, y: 52 }]);
  assert.equal(pasted.nodes[0].position.x, copied.nodes[0].position.x + 32);
  assert.equal(again.nodes[0].position.x, copied.nodes[0].position.x + 64);
  assert.ok(pasted.nodes.every(node => !saved.nodes.some(original => original.id === node.id)));
});
Then('pasted nested workflows retain their original snapshot interfaces', () => {
  const snapshot = document(graph('inner'));
  const nested = createWorkflowGraph(snapshot, { x: 20, y: 30 }, 'nested');
  const copied = copyWorkflowSelection(document(nested), ['nested'], []);
  const pasted = pasteWorkflowSelection(copied);
  validateWorkflowDocument(document(pasted));
  assert.deepEqual(pasted.nodes.find(node => node.type === 'workflow').data.snapshot, snapshot);
  const endpoints = value => value.nodes.filter(node => node.type === 'data').flatMap(node => node.data.fields.map(field => field.endpoint));
  assert.deepEqual(endpoints(pasted), endpoints(copied));
});

Then('copying legacy operation connections preserves edges without handles', () => {
  const first = graph('first').nodes[0], other = graph('other').nodes[0];
  const saved = document({ version: 1, nodes: [first, other], edges: [{ id: 'legacy', source: first.id, target: other.id }] });
  validateWorkflowDocument(saved);
  const copied = copyWorkflowSelection(saved, ['first', 'other'], []);
  const pasted = pasteWorkflowSelection(copied);
  validateWorkflowDocument(document({ ...pasted, nodes: [...saved.nodes, ...pasted.nodes], edges: [...saved.edges, ...pasted.edges] }));
  assert.equal(pasted.edges.length, 1);
  assert.notEqual(pasted.edges[0].id, 'legacy');
  assert.equal(pasted.edges[0].source, pasted.nodes[0].id);
  assert.equal(pasted.edges[0].target, pasted.nodes[1].id);
  assert.equal(Object.hasOwn(pasted.edges[0], 'sourceHandle'), false);
  assert.equal(Object.hasOwn(pasted.edges[0], 'targetHandle'), false);
});
