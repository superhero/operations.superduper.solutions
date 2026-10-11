// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationGraph, getAdditionalPropertyTypes } from '../src/lib/workflow-graph.ts';

const output = 'response:200:application/json';
const types = ['Text', 'Integer', 'Number', 'Boolean', 'Object', 'Array', 'Null'];
const identity = (group, path) => encodeURIComponent(JSON.stringify([group, path]));
const nodeId = (group, path) => `owner:${identity(group, path)}`;
const operation = { id: 'test:read', name: 'Read', description: '', method: 'POST', path: '/items',
  fields: [], bodyRequired: false, bodyMediaType: 'application/json' };

function fixture(schema = { type: 'object' }) {
  const source = {
    requestBody: { content: { 'application/json': { schema } } },
    responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
  };
  const document = { paths: { '/items': { post: source } } };
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document);
  return { ...graph, document, source, schema };
}

const panel = (group, path, direction = 'outputs') => ({ id: nodeId(group, path), type: 'data',
  position: { x: 0, y: 0 }, data: { ownerId: 'owner', direction, label: 'Imported panel', fields: [] } });
const allowed = (graph, id = nodeId(output, '/body')) => getAdditionalPropertyTypes(graph.nodes, id, graph.document);

test('response headers project one documented content representation and keep ambiguous headers nonconnectable', () => {
  const graph = fixture();
  graph.source.responses[200].headers = {
    Count: { required: true, description: 'Remaining requests', content: { 'text/plain': { schema: { type: 'integer' } } } },
    Ambiguous: { content: { 'text/plain': { schema: { type: 'string' } }, 'application/json': { schema: { type: 'object' } } } },
    Missing: { content: { 'text/plain': null } },
    Unavailable: { $ref: 'https://remote.example.test/header' },
  };
  const projected = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', graph.document);
  const fields = projected.nodes.find(node => node.id === nodeId(output, '/headers')).data.fields;
  assert.deepEqual(fields.map(field => [field.label, field.type, field.connectable]), [
    ['Count', 'Integer', true], ['Ambiguous', 'Unknown', false], ['Missing', 'Unknown', false], ['Unavailable', 'Unknown', false],
  ]);
  assert.equal(fields[0].required, true);
  assert.equal(fields[0].description, 'Remaining requests');
});

test('malformed additional-property constraints cannot enable arbitrary fields', () => {
  for (const schema of [
    { type: 'object', properties: [] }, { type: 'object', required: 'name' }, { type: 'object', required: [1] },
    { type: 'array', items: [] }, { type: 'string', enum: 'value' }, { type: 'string', enum: [] },
    { type: ['string', 'number'] }, { type: 'object', dependentSchemas: {} },
  ]) {
    const graph = fixture({ type: 'object', additionalProperties: schema });
    assert.deepEqual(allowed(graph), [], JSON.stringify(schema));
  }
  assert.deepEqual(allowed(fixture({ type: 'object', additionalProperties: { type: 'string', enum: ['value'] } })), ['Text']);
});

test('imported panels require a real owner and a canonical, well-formed schema identity', () => {
  for (const mutate of [
    graph => { graph.nodes = graph.nodes.filter(node => node.id !== 'owner'); },
    graph => { graph.nodes[0].type = 'cast'; },
    (graph, node) => { node.id = `another:${identity(output, '/body')}`; },
    (graph, node) => { node.id = `owner:${encodeURIComponent('{}')}`; },
    (graph, node) => { node.id = `owner:${encodeURIComponent(JSON.stringify([output, 1]))}`; },
    (graph, node) => { node.id = `owner:${encodeURIComponent(JSON.stringify([output, '/body', 'extra']))}`; },
    (graph, node) => { node.id = node.id.replace('%5B', '%5b'); },
    (graph, node) => { node.id = nodeId(output, 'body'); },
    (graph, node) => { node.id = nodeId(output, '/bad~2pointer'); },
  ]) {
    const graph = fixture();
    const node = graph.nodes.find(node => node.id === nodeId(output, '/body'));
    mutate(graph, node);
    assert.deepEqual(allowed(graph, node.id), []);
  }
  const legacyOwner = fixture();
  delete legacyOwner.nodes[0].type;
  assert.deepEqual(allowed(legacyOwner), types, 'Legacy operation owners without an explicit type remain supported.');
});

test('legacy output panels require an available response and a named object media representation', () => {
  const check = (group, mutate, expected = []) => {
    const graph = fixture();
    const node = panel(group, '');
    graph.nodes.push(node);
    mutate(graph);
    assert.deepEqual(allowed(graph, node.id), expected);
  };
  check('output:200:application/json', () => {}, types);
  check('output:200', () => {});
  check('output:200:application/json', graph => { graph.source.responses[200].content = []; });
  check('output:200:application/json', graph => { graph.source.responses[200].content['application/json'] = null; });
  check('output:200:application/json', graph => { graph.source.responses[200] = { $ref: '#/missing' }; });
  check('invalid-group', () => {});
  check(output, graph => { delete graph.source.responses; });
});

test('stale imported child panels cannot authorize changes through missing parents or changed schemas', () => {
  const childId = nodeId(output, '/body/child');
  for (const mutate of [
    graph => { graph.nodes = graph.nodes.filter(node => node.id !== nodeId(output, '/body')); },
    graph => { graph.nodes.find(node => node.id === nodeId(output, '/body')).type = 'operation'; },
    graph => { graph.nodes.find(node => node.id === nodeId(output, '/body')).data.fields = []; },
    graph => { graph.nodes.find(node => node.id === nodeId(output, '/body')).data.fields[0].connectable = false; },
    graph => { graph.schema.patternProperties = {}; },
    graph => { delete graph.schema.properties.child; graph.schema.additionalProperties = false; },
    graph => { delete graph.schema.properties.child; graph.schema.additionalProperties = { type: 'string' }; },
    graph => { graph.schema.properties.child = { type: 'string' }; },
    graph => {
      graph.schema.type = 'string'; delete graph.schema.properties;
      graph.nodes.find(node => node.id === nodeId(output, '')).data.fields.find(field => field.label === 'Response body').type = 'Text';
    },
  ]) {
    const graph = fixture({ type: 'object', properties: { child: { type: 'object' } } });
    assert.deepEqual(allowed(graph, childId), types);
    mutate(graph);
    assert.deepEqual(allowed(graph, childId), []);
  }
});

test('imported array panels reject unsupported item constraints and paths beyond the expansion limit', () => {
  const graph = fixture({ type: 'array', items: { type: 'object' } });
  const itemsId = nodeId(output, '/body/items');
  assert.deepEqual(allowed(graph, itemsId), types);
  graph.schema.contains = { type: 'object' };
  assert.deepEqual(allowed(graph, itemsId), []);

  const deep = fixture();
  const deepNode = panel(output, '/body' + '/child'.repeat(11));
  deep.nodes.push(deepNode);
  assert.deepEqual(allowed(deep, deepNode.id), []);

  const absentInput = panel('input:missing', '/child', 'inputs');
  deep.nodes.push(absentInput);
  assert.deepEqual(allowed(deep, absentInput.id), [], 'A removed input group cannot be recovered from a stale child panel.');
});
