// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { createOperationGraph, createUtilityNode, addAdditionalProperty, getEditableAdditionalProperties,
  updateAdditionalProperty, removeAdditionalProperty } from './lib/workflow-graph.ts';

const identity = (path, group = 'input:body') => encodeURIComponent(JSON.stringify([group, path]));
const field = (id) => ({ id, label: 'Imported field', type: 'Text', required: false, description: '', connectable: true });
function fixture(schema = { type: 'object' }) {
  const operation = { id: 'test:post', name: 'Test operation', description: '', method: 'POST', path: '/test',
    fields: [], bodyRequired: true, bodyMediaType: 'application/json' };
  const document = { paths: { '/test': { post: { requestBody: { content: { 'application/json': { schema } } }, responses: {} } } } };
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document);
  const node = graph.nodes.find(node => node.id === `owner:${identity('')}`);
  return { graph, node, document };
}
const add = (fixture, name, type = 'Text', nodeId = fixture.node.id) => {
  fixture.graph = addAdditionalProperty(fixture.graph.nodes, fixture.graph.edges, nodeId, name, type, fixture.document);
  return fixture;
};

Then('only canonical direct workflow user properties are offered for editing', () => {
  const f = fixture({ type: 'object', properties: { fixed: { type: 'string' } } });
  f.node.data.fields.push(...['%', 'null', identity('/x', 'wrong-group'), identity('outside'),
    identity('/child/nested'), identity('/bad~2'), identity('/valid')].map(field));
  assert.deepEqual(getEditableAdditionalProperties(f.graph.nodes, f.node.id, f.document).map(item => item.name), ['valid']);
  assert.deepEqual(getEditableAdditionalProperties(f.graph.nodes, 'missing', f.document), []);
  const constrained = fixture({ type: 'object', additionalProperties: { type: 'string', enum: [] } });
  assert.deepEqual(getEditableAdditionalProperties(constrained.graph.nodes, constrained.node.id, constrained.document), []);
});

Then('removing the last custom workflow field restores the empty-object notice', () => {
  const f = add(fixture(), 'last');
  const result = removeAdditionalProperty(f.graph.nodes, f.graph.edges, f.node.id, identity('/last'), f.document);
  const node = result.nodes.find(node => node.id === f.node.id);
  assert.deepEqual(node.data.fields, []);
  assert.equal(node.data.notice, 'No named properties documented');
});

Then('workflow input property type changes retain incoming wires and unrelated mappings', () => {
  const f = add(fixture(), 'old');
  for (const id of ['source', 'other']) f.graph.nodes.push(createUtilityNode('cast', { x: 800, y: 0 }, id));
  f.graph.edges.push({ id: 'incoming', kind: 'mapping', source: 'source', sourceHandle: 'result', target: f.node.id, targetHandle: identity('/old') },
    { id: 'unrelated', kind: 'mapping', source: 'source', sourceHandle: 'result', target: 'other', targetHandle: 'value' });
  const result = updateAdditionalProperty(f.graph.nodes, f.graph.edges, f.node.id, identity('/old'), 'new', 'Number', f.document);
  assert.equal(result.edges.find(edge => edge.id === 'incoming').targetHandle, identity('/new'));
  assert.deepEqual(result.edges.find(edge => edge.id === 'unrelated'), f.graph.edges.find(edge => edge.id === 'unrelated'));
});

Then('workflow property renaming preserves order-only edges and recalculates required names', () => {
  const f = add(fixture({ type: 'object', required: ['new'] }), 'old');
  const other = structuredClone(f.graph.nodes[0]);
  other.id = 'other';
  f.graph.nodes.push(other, { ...structuredClone(other), id: 'third' });
  f.graph.edges.push({ id: 'order', source: 'other', target: 'third' });
  const result = updateAdditionalProperty(f.graph.nodes, f.graph.edges, f.node.id, identity('/old'), 'new', 'Text', f.document);
  assert.deepEqual(result.edges.find(edge => edge.id === 'order'), { id: 'order', source: 'other', target: 'third' });
  assert.equal(result.nodes.find(node => node.id === f.node.id).data.fields[0].required, true);
});

Then('renaming a workflow branch rejects malformed descendant identities without changing its source graph', () => {
  for (const invalid of ['%', identity('/unrelated'), identity('/old/value', 'wrong-group')]) {
    const f = add(fixture(), 'old', 'Object');
    const child = f.graph.nodes.find(node => node.id === `owner:${identity('/old')}`);
    child.data.fields.push(field(invalid));
    const before = structuredClone(f.graph);
    assert.throws(() => updateAdditionalProperty(f.graph.nodes, f.graph.edges, f.node.id, identity('/old'), 'new', 'Object', f.document), /supported schema identities/);
    assert.deepEqual(f.graph, before);
  }
});

Then('workflow branch renaming enforces descendant path and encoded identity limits', () => {
  for (const name of ['n'.repeat(200), '雪'.repeat(180)]) {
    const f = add(fixture(), 'old', 'Object');
    add(f, 'a'.repeat(200), 'Object', `owner:${identity('/old')}`);
    add(f, 'b'.repeat(200), 'Text', `owner:${identity(`/old/${'a'.repeat(200)}`)}`);
    const before = structuredClone(f.graph);
    assert.throws(() => updateAdditionalProperty(f.graph.nodes, f.graph.edges, f.node.id, identity('/old'), name, 'Object', f.document), /schema size or depth limits/);
    assert.deepEqual(f.graph, before);
  }
});
