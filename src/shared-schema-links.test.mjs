// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { createOperationGraph, createUtilityNode, schemaBranches } from './lib/workflow-graph.ts';
import { validateWorkflowDocument } from './lib/workflow-document.ts';
import { isInputLink, expandInputLinks, hasInputLink } from './lib/workflow-input-links.ts';
import { responseGroup, schemaShape, isResponseLink, linkedResponseGroups } from './lib/workflow-response-links.ts';
import { updateOperationVersion } from './lib/workflow-operation-version.ts';
import { operationCategoryPaths } from './lib/operation-navigation.ts';

const identity = (group, path = '') => encodeURIComponent(JSON.stringify([group, path]));
const panelId = (owner, group, path = '') => `${owner}:${identity(group, path)}`;
function fixture() {
  const schema = { type: 'object', properties: { configuration: { type: 'object', properties: { name: { type: 'string' } } } } };
  const operation = { id: 'test:apply', name: 'Apply', description: '', method: 'POST', path: '/items',
    fields: [], bodyRequired: true, bodyMediaType: 'application/json' };
  const document = { paths: { '/items': { post: {
    requestBody: { required: true, content: { 'application/json': { schema } } },
    responses: { 200: { description: 'OK', content: { 'application/json': { schema } } },
      404: { description: 'Missing', content: { 'application/json': { schema } } } },
  } } } };
  const first = createOperationGraph(operation, { x: 0, y: 0 }, 'first', document);
  const second = createOperationGraph(operation, { x: 800, y: 0 }, 'second', document);
  const nodes = [...first.nodes, ...second.nodes], edges = [...first.edges, ...second.edges];
  const source = panelId('first', 'input:body'), destination = panelId('second', 'input:body');
  const attachment = edges.find(edge => edge.source === destination && edge.target === 'second');
  const input = { id: 'shared-input', kind: 'input', source, sourceHandle: 'value', target: 'second', targetHandle: attachment.targetHandle };
  const responseTarget = panelId('first', 'response:200:application/json');
  const responseSource = edges.find(edge => edge.source === 'first' && edge.target === panelId('first', 'response:404:application/json'));
  const response = { id: 'shared-response', kind: 'response', source: 'first', sourceHandle: responseSource.sourceHandle,
    target: responseTarget, targetHandle: 'value' };
  return { operation, document, nodes, edges, source, destination, input, response };
}
const workflow = graph => ({ version: 3, id: 'shared', name: 'Shared', nodes: graph.nodes, edges: graph.edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false });
const panel = (graph, owner, group, path = '') => graph.nodes.find(node => node.id === panelId(owner, group, path));

Then(/^shared input connections reject (.+)$/, reason => {
  const graph = fixture();
  assert.equal(isInputLink(graph.input, graph.nodes, graph.edges), true);
  if (reason === 'unattached source') graph.edges = graph.edges.filter(edge => !(edge.source === graph.source && edge.target === 'first'));
  if (reason === 'unattached destination') graph.edges = graph.edges.filter(edge => edge.source !== graph.destination);
  if (reason === 'existing shared input') graph.edges.push(graph.input);
  if (reason === 'mapped nested field') graph.edges.push({ id: 'local', kind: 'mapping', source: 'literal', sourceHandle: 'value',
    target: panelId('second', 'input:body', '/configuration'), targetHandle: identity('input:body', '/configuration/name') });
  if (reason === 'different nested type') panel(graph, 'second', 'input:body', '/configuration').data.fields[0].type = 'Integer';
  assert.equal(isInputLink(graph.input, graph.nodes, graph.edges), false);
});
Then('shared input expansion reveals destination descendants and copies only active mappings', () => {
  const graph = fixture(), child = panel(graph, 'first', 'input:body', '/configuration');
  graph.nodes.push(createUtilityNode('cast', { x: 0, y: 0 }, 'literal'));
  for (const node of graph.nodes.filter(node => node.type === 'data' && node.data.ownerId === 'second' && node.data.direction === 'inputs')) node.hidden = true;
  graph.edges.push(graph.input, { ...graph.input, id: 'inactive-input', hidden: true }, { ...graph.input, id: 'detached-input', detached: true });
  const mapping = { id: 'field', kind: 'mapping', source: 'literal', sourceHandle: 'result', target: child.id, targetHandle: child.data.fields[0].id };
  graph.edges.push(mapping, { ...mapping, id: 'hidden', hidden: true }, { ...mapping, id: 'detached', detached: true });
  const before = structuredClone(graph), expanded = expandInputLinks(workflow(graph));
  const destinationChild = panelId('second', 'input:body', '/configuration');
  assert.deepEqual(expanded.edges.filter(edge => edge.id.startsWith('shared-input:')), [{ ...mapping, id: 'shared-input:field', target: destinationChild }]);
  assert.ok(expanded.nodes.filter(node => node.type === 'data' && node.data.ownerId === 'second' && node.data.direction === 'inputs').every(node => node.hidden === false));
  assert.ok(expanded.edges.every(edge => edge.kind !== 'input'));
  assert.equal(hasInputLink(destinationChild, graph.edges), true);
  assert.equal(hasInputLink('literal', graph.edges), false);
  assert.deepEqual(graph, before);
});
Then('input expansion tolerates {word} source trees without fabricating mappings', kind => {
  const graph = fixture();
  if (kind === 'unsupported') graph.input.source = 'first';
  else panel(graph, 'first', 'input:body', '/configuration').data.fields[0].id = 'unmatched';
  graph.edges.push(graph.input);
  const expanded = expandInputLinks(workflow(graph));
  assert.ok(expanded.edges.every(edge => edge.kind !== 'input'));
  assert.equal(expanded.edges.some(edge => edge.id.startsWith('shared-input:')), false);
});
Then('workflow imports reject a {word} shared input link', kind => {
  const flags = { hidden: { hidden: true }, detached: { detached: true }, incompatible: { targetHandle: 'wrong' } }[kind];
  const graph = fixture(); graph.edges.push({ ...graph.input, ...flags });
  assert.throws(() => validateWorkflowDocument(workflow(graph)), /Shared inputs must connect compatible/);
});
Then('cyclic schema descriptions and input ancestry terminate without inventing fields', () => {
  const graph = fixture(), child = panel(graph, 'first', 'input:body', '/configuration');
  const cycle = { id: 'cycle', kind: 'schema', source: graph.source, sourceHandle: 'value', target: child.id, targetHandle: child.data.fields[0].id };
  graph.edges.push(cycle);
  const shape = schemaShape(graph.source, graph.nodes, graph.edges);
  assert.equal(shape.fields[0].child.fields[0].child, 'cycle');
  assert.equal(hasInputLink(graph.source, graph.edges.filter(edge => !(edge.source === graph.source && edge.target === 'first'))), false);
  assert.equal(schemaShape('missing', graph.nodes, graph.edges), '');
  child.data.fields[0].id = 'raw%field';
  assert.equal(schemaShape(child.id, graph.nodes, []).fields[0].path, 'raw%field');
});
Then('response identity {word} resolves to {word}', (kind, expected) => {
  const ids = { generated: panelId('owner', 'response:200'), foreign: 'foreign', empty: 'owner:', malformed: 'owner:%',
    nonarray: 'owner:%22text%22', numeric: 'owner:%5B1%5D' };
  assert.equal(responseGroup(ids[kind], 'owner'), expected === 'response' ? 'response:200' : undefined);
});
Then(/^response links reject (.+)$/, reason => {
  const graph = fixture();
  assert.equal(isResponseLink(graph.response, graph.nodes, graph.edges), true);
  if (reason === 'unattached source') graph.edges = graph.edges.filter(edge => !(edge.source === 'first' && edge.sourceHandle === graph.response.sourceHandle));
  if (reason === 'unattached destination') graph.edges = graph.edges.filter(edge => !(edge.source === 'first' && edge.target === graph.response.target));
  if (reason === 'same panel') graph.response.target = panelId('first', 'response:404:application/json');
  if (reason === 'invalid source group') panel(graph, 'first', 'response:404:application/json').data.fields[0].id = identity('input:body');
  if (reason === 'invalid target group') panel(graph, 'first', 'response:200:application/json').data.fields[0].id = identity('input:body');
  assert.equal(isResponseLink(graph.response, graph.nodes, graph.edges), false);
});
Then('incomplete response links report no source group', () => {
  const graph = fixture(); graph.edges.push({ ...graph.response, sourceHandle: 'missing' });
  assert.deepEqual(linkedResponseGroups(graph.response.target, 'first', graph.edges, graph.nodes), []);
});
Then('a {word} shared input makes its hidden branch {word}', (kind, visibility) => {
  const graph = fixture(); panel(graph, 'second', 'input:body').hidden = true;
  const flags = { active: {}, hidden: { hidden: true }, detached: { detached: true },
    'another-owner': { target: 'first' }, 'another-handle': { targetHandle: 'other' } }[kind];
  graph.edges.push({ ...graph.input, ...flags });
  assert.equal(schemaBranches(graph.nodes, graph.edges).get('second').get(graph.input.targetHandle).hidden, visibility === 'restorable');
});
Then('changing an operation contract retains compatible shared input and response links', () => {
  const graph = fixture(); graph.edges.push(graph.input, graph.response);
  const next = updateOperationVersion('first', graph.operation, graph.document, graph.nodes, graph.edges);
  assert.deepEqual(next.edges.find(edge => edge.id === graph.input.id), graph.input);
  assert.deepEqual(next.edges.find(edge => edge.id === graph.response.id), graph.response);
});
Then('a {word} shared response makes its hidden branch {word}', (kind, visibility) => {
  const graph = fixture(); panel(graph, 'first', 'response:404:application/json').hidden = true;
  const flags = { active: {}, hidden: { hidden: true }, detached: { detached: true },
    'another-owner': { source: 'second' }, 'another-handle': { sourceHandle: 'other' } }[kind];
  graph.edges.push({ ...graph.response, ...flags });
  assert.equal(schemaBranches(graph.nodes, graph.edges).get('first').get(graph.response.sourceHandle).hidden, visibility === 'restorable');
});
Then('catalog paths tolerate empty groups and retain the first duplicate operation location', () => {
  const paths = operationCategoryPaths([{ id: 'empty', name: 'Empty' },
    { id: 'one', name: 'first_group', operationIds: ['upload'] }, { id: 'two', name: 'second_group', operationIds: ['upload'] }]);
  assert.deepEqual([...paths], [['upload', ['First Group']]]);
});
