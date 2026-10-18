// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { operations } from './lib/catalog.ts';
import { catalogForOperation } from './lib/catalog-registry.ts';
import { createOperationGraph, createUtilityNode } from './lib/workflow-graph.ts';
import { validateWorkflowDocument } from './lib/workflow-document.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { createWorkflowDemo } from './lib/workflow-demo.ts';
import { routingInputTypes } from './lib/workflow-utilities.ts';
import { routePath } from './lib/flow-routing/path.js';
import { routeConnection } from './lib/flow-routing/router.js';

const at = { x: 0, y: 0 };
const document = (...graphs) => ({ version: 3, id: 'defensive-behavior', name: 'Defensive behavior',
  nodes: graphs.flatMap(graph => graph.nodes), edges: graphs.flatMap(graph => graph.edges),
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
const projectGraph = id => {
  const operation = operations.find(item => item.id === 'demo:getProject');
  assert.ok(operation);
  return createOperationGraph(operation, at, id, catalogForOperation(operation.id).document);
};
const field = (graph, owner, direction, label) => {
  for (const node of graph.nodes) if (node.type === 'data' && node.data.ownerId === owner && node.data.direction === direction) {
    const value = node.data.fields.find(candidate => candidate.label === label);
    if (value) return { node, field: value };
  }
  assert.fail(`Missing ${owner} ${direction} field ${label}`);
};
const renamePanel = (graph, panel, id) => {
  const previous = panel.id;
  panel.id = id;
  for (const edge of graph.edges) {
    if (edge.source === previous) edge.source = id;
    if (edge.target === previous) {
      edge.target = id;
      if (edge.kind === 'schema') {
        const oldEdgeId = edge.id;
        edge.id = `schema:${id}`;
        if (edge.sourceHandle === oldEdgeId) edge.sourceHandle = edge.id;
      }
    }
  }
};
const runOneProject = async doc => {
  validateWorkflowDocument(doc);
  const runner = createWorkflowRunner(doc, undefined, createWorkflowDemo());
  const visit = runner.next();
  assert.equal(visit.kind, 'operation');
  const result = await runner.submit({ ...visit.values, 'path:projectId': 'project-1' });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.body.id, 'project-1');
  assert.equal(runner.next().kind, 'complete');
};

Then('an output array with write-only items retains an empty array panel', () => {
  const operation = { id: 'regression:read', name: 'Read', description: '', method: 'GET',
    path: '/items', fields: [], bodyRequired: false };
  const schema = { paths: { '/items': { get: { responses: { 200: {
    description: 'OK', content: { 'application/json': { schema: {
      type: 'array', items: { type: 'string', writeOnly: true },
    } } },
  } } } } } };
  const graph = createOperationGraph(operation, at, 'owner', schema);
  const panel = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.array);
  assert.ok(panel, 'The array itself is represented');
  assert.deepEqual(panel.data.fields, [], 'Write-only item values are not projected as response fields');
  assert.deepEqual(panel.data.array, { min: 0 });
});

Then('renaming a response body panel preserves downstream response mapping', async () => {
  const first = projectGraph('first'), second = projectGraph('second');
  const source = field(first, 'first', 'outputs', 'Project ID');
  renamePanel(first, source.node, 'imported-body-panel');
  const target = field(second, 'second', 'inputs', 'Project ID');
  const doc = document(first, second);
  doc.edges.push({ id: 'project-mapping', kind: 'mapping', source: source.node.id, sourceHandle: source.field.id,
    target: target.node.id, targetHandle: target.field.id });
  validateWorkflowDocument(doc);
  const runner = createWorkflowRunner(doc, undefined, createWorkflowDemo());
  assert.equal(runner.next().nodeId, 'first');
  await runner.submit({ 'path:projectId': 'project-1' });
  const next = runner.next();
  assert.equal(next.kind, 'operation');
  assert.equal(next.nodeId, 'second');
  assert.equal(next.values['path:projectId'], 'project-1');
  await runner.submit(next.values);
  assert.equal(runner.next().kind, 'complete');
});

Then('an unrelated nonconnectable output field does not change a successful response', async () => {
  const graph = projectGraph('owner');
  const panel = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.label === 'Response headers');
  assert.ok(panel);
  panel.data.fields.push({ id: encodeURIComponent(JSON.stringify(['metadata', '/note'])), label: 'Imported metadata',
    type: 'Text', required: false, connectable: false, description: '' });
  await runOneProject(document(graph));
});

Then('an unused unselected vault variable does not block an ordinary workflow', async () => {
  const graph = projectGraph('owner');
  graph.nodes.push(createUtilityNode('vault', at, 'unused-vault-variable'));
  await runOneProject(document(graph));
});

Then('an unavailable switch mapping source retains the unknown routing type', () => {
  const node = createUtilityNode('switch', at, 'switch');
  const edges = [{ id: 'removed-source', kind: 'mapping', source: 'unavailable', sourceHandle: 'value', target: node.id, targetHandle: 'value' }];
  const before = structuredClone({ node, edges });
  assert.equal(routingInputTypes([node], edges).get(node.id), 'Unknown');
  assert.deepEqual({ node, edges }, before, 'Defensive inference does not mutate a partially reconciled graph');
});

Then('rounding a single-point route falls back to its move command', () => {
  const route = { points: [{ x: 12, y: 34 }], length: 0, status: 'routed' };
  assert.equal(routePath(route, 8), 'M 12 34');
  assert.equal(routePath(route, 0), 'M 12 34');
  assert.deepEqual(route.points, [{ x: 12, y: 34 }]);
});

Then('a far collinear route does not change the chosen connection path', () => {
  const edge = { id: 'connection', source: 'a', target: 'b', sourceX: 0, sourceY: 0,
    targetX: 300, targetY: 200, sourcePosition: 'right', targetPosition: 'left' };
  const existing = [{ id: 'far', source: 'c', target: 'd', points: [{ x: 400, y: 0 }, { x: 500, y: 0 }] }];
  const before = structuredClone(existing);
  const baseline = routeConnection(edge, []);
  assert.ok(baseline.points.length >= 4, 'The candidate has interior segments eligible for alignment');
  assert.deepEqual(routeConnection(edge, [], existing), baseline);
  assert.deepEqual(existing, before, 'Existing connections stay unchanged');
});
