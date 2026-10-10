// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { describeWorkflowChange } from './lib/workflow-change-message.ts';

const workflow = (nodes = [], edges = []) => ({ version: 3, id: 'message-workflow', name: 'Project delivery', description: '', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false });
const operation = (id, name) => ({ id, type: 'operation', position: { x: 200, y: 100 },
  data: { operationId: `demo:${id}`, name, description: '', method: 'GET', path: `/${id}` } });
const branch = (id, name) => {
  const owner = operation(id, name);
  const panels = ['inputs', 'outputs'].map(direction => ({ id: `${id}-${direction}`, type: 'data', position: { x: 400, y: 100 },
    data: { ownerId: id, direction, label: direction === 'inputs' ? 'Path parameters' : 'Response',
      fields: [{ id: `${id}-${direction}-field`, label: direction === 'inputs' ? 'Project reference' : 'Project ID',
        type: 'Text', required: true, description: '', connectable: true }] } }));
  const edges = panels.map(panel => ({ id: `schema:${panel.id}`, kind: 'schema',
    source: panel.data.direction === 'inputs' ? panel.id : id, target: panel.data.direction === 'inputs' ? id : panel.id,
    sourceHandle: panel.data.direction === 'inputs' ? 'value' : `schema:${panel.id}`,
    targetHandle: panel.data.direction === 'inputs' ? `schema:${panel.id}` : 'value' }));
  return workflow([owner, ...panels], edges);
};
const describe = (before, after, ...patterns) => {
  const message = describeWorkflowChange(before, after);
  assert.equal(typeof message, 'string');
  assert.doesNotMatch(message, /^Update workflow$/i);
  for (const pattern of patterns) assert.match(message, pattern);
  return message;
};

Then('workflow change messages describe added removed and moved operations', function () {
  const graph = branch('lookup-owner', 'Get project');
  for (const [before, after, verb] of [[workflow(), graph, /add/i], [graph, workflow(), /remov|delet/i]]) {
    const message = describe(before, after, verb, /Get project/);
    assert.doesNotMatch(message, /Path parameters|Response|schema:|lookup-owner/);
  }
  const moved = structuredClone(graph);
  moved.nodes[0].position.x += 48;
  describe(graph, moved, /mov/i, /Get project/);
  describe(null, workflow(), /creat|initial/i);
});

Then('workflow change messages describe connected and disconnected fields by their owners and labels', function () {
  const source = branch('lookup-owner', 'Get project');
  const target = branch('deployment-owner', 'Create deployment');
  const before = workflow([...source.nodes, ...target.nodes], [...source.edges, ...target.edges]);
  const after = structuredClone(before);
  after.edges.push({ id: 'private-mapping-id', kind: 'mapping', source: 'lookup-owner-outputs', sourceHandle: 'lookup-owner-outputs-field',
    target: 'deployment-owner-inputs', targetHandle: 'deployment-owner-inputs-field' });
  for (const [first, second, verb] of [[before, after, /connect|map/i], [after, before, /disconnect|remov|unmap/i]]) {
    const message = describe(first, second, verb, /Get project/, /Project ID/, /Create deployment/, /Project reference/);
    assert.doesNotMatch(message, /private-mapping-id|lookup-owner|deployment-owner|schema:/);
  }
});

Then('workflow change messages distinguish settings names and descriptions', function () {
  const before = workflow([{ id: 'cast', type: 'cast', position: { x: 0, y: 0 }, data: { targetType: 'Text' } }]);
  const configured = structuredClone(before);
  configured.nodes[0].data.targetType = 'Number';
  describe(before, configured, /cast/i, /number/i);
  describe(before, { ...before, name: 'Deploy production' }, /renam|name/i, /Deploy production/);
  describe(before, { ...before, description: 'Run after project approval.' }, /description/i);
});

Then('workflow change messages summarize grouped edits without schema noise', function () {
  const first = branch('lookup-owner', 'Get project');
  const second = branch('deployment-owner', 'Create deployment');
  const after = workflow([...first.nodes, ...second.nodes], [...first.edges, ...second.edges]);
  after.name = 'Deploy production';
  const message = describe(workflow(), after, /add/i, /Get project/, /Create deployment/, /renam|name/i, /Deploy production/);
  assert.doesNotMatch(message, /Path parameters|Response|schema:|lookup-owner|deployment-owner/);
});

const utility = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data });
const gate = (id, operator = '==', value = '') => ({ id, operator, value });
const nested = (id, snapshot) => utility(id, 'workflow', { workflowId: snapshot.id, name: snapshot.name, description: '', snapshot });
const field = (id, label) => ({ id, label, type: 'Text', required: false, description: '', connectable: true });
const mapping = (id, source, sourceHandle, target, targetHandle) => ({ id, kind: 'mapping', source, sourceHandle, target, targetHandle });

Then('workflow change messages number instances and bound long grouped labels', function () {
  const first = operation('copy-one', 'Get project');
  const second = { ...structuredClone(first), id: 'copy-two' };
  const legacy = { ...structuredClone(first), id: 'copy-three' };
  delete legacy.type;
  const snapshot = workflow([operation('inner', 'Inner operation')]);
  snapshot.name = 'Release';
  const references = [nested('ref-one', snapshot), nested('ref-two', structuredClone(snapshot))];
  const graph = workflow([first, second, legacy, ...references]);
  assert.equal(describe(workflow(), graph), 'Add “Get project” #1, “Get project” #2, “Get project” #3 and 2 more');
  assert.equal(describe(graph, workflow()), 'Remove “Get project” #1, “Get project” #2, “Get project” #3 and 2 more');
  assert.equal(describe(workflow(), workflow(references)), 'Add Workflow “Release” #1, Workflow “Release” #2');
  const title = `  Fetch\n ${'x'.repeat(100)}  `;
  const message = describe(workflow(), workflow([operation('long-private-id', title)]));
  assert.equal(message, `Add “Fetch ${'x'.repeat(65)}…”`);
  assert.equal(describe(null, workflow([legacy])), 'Create workflow “Project delivery”; Add “Get project”');
});

Then('workflow change messages describe panel movement and subtree visibility', function () {
  const before = branch('lookup', 'Get project');
  const together = structuredClone(before);
  for (const node of together.nodes) { node.position.x += 24; node.position.y += 12; }
  assert.equal(describe(before, together), 'Move “Get project”');
  const panelOnly = structuredClone(before);
  panelOnly.nodes[1].position.y += 24;
  assert.equal(describe(before, panelOnly), 'Move “Get project” · Input · Path');
  const uneven = structuredClone(together);
  uneven.nodes[1].position.y += 12;
  assert.equal(describe(before, uneven), 'Move “Get project”, “Get project” · Input · Path');

  const child = { ...structuredClone(before.nodes[2]), id: 'lookup-object', data: { ...structuredClone(before.nodes[2].data), label: 'Project object' } };
  before.nodes[2].data.fields.push({ ...field('object', 'Project object'), type: 'Object' });
  before.nodes.push(child);
  before.edges.push({ id: 'schema:lookup-object', kind: 'schema', source: 'lookup-outputs', sourceHandle: 'object', target: child.id, targetHandle: 'value' });
  const hidden = structuredClone(before);
  for (const node of hidden.nodes) if (node.type === 'data' && node.data.direction === 'outputs') node.hidden = true;
  for (const edge of hidden.edges) if (edge.target === 'lookup-outputs' || edge.target === 'lookup-object') edge.hidden = true;
  hidden.edges.find(edge => edge.target === 'lookup-outputs').detached = true;
  assert.equal(describe(before, hidden), 'Hide “Get project” · Output · Response');
  assert.equal(describe(hidden, before), 'Show “Get project” · Output · Response');
  const leafHidden = structuredClone(before);
  leafHidden.nodes.at(-1).hidden = true;
  leafHidden.edges.at(-1).hidden = true;
  leafHidden.edges.at(-1).detached = true;
  assert.equal(describe(before, leafHidden), 'Hide “Get project” · Output · Project object');
  assert.equal(describe(leafHidden, before), 'Show “Get project” · Output · Project object');

  // Imported schemas may acquire their owner after the initial partial snapshot.
  const withoutOwner = workflow([structuredClone(before.nodes[1])]);
  const withOwner = workflow([structuredClone(before.nodes[0]), structuredClone(before.nodes[1])]);
  withOwner.nodes[1].position.x += 12;
  describe(withoutOwner, withOwner, /Add “Get project”/, /Move “Get project” · Input · Path/);
});

Then('workflow change messages describe rewired utility and legacy connections', function () {
  const source = branch('get', 'Get project');
  const target = branch('deploy', 'Create deployment');
  const switchNode = utility('switch', 'switch', { gates: [gate('approved', '==', 'yes'), gate('other', 'is_set')] });
  const cast = utility('cast', 'cast', { targetType: 'Text' });
  const before = workflow([...source.nodes, ...target.nodes, switchNode, cast]);
  const connections = [
    mapping('switch-input', 'get-outputs', 'get-outputs-field', 'switch', 'value'),
    mapping('gate-value', 'get-outputs', 'get-outputs-field', 'switch', 'gate-value:approved'),
    mapping('switch-output', 'switch', 'approved', 'cast', 'value'),
    mapping('cast-output', 'cast', 'result', 'deploy-inputs', 'deploy-inputs-field')
  ];
  const expected = [
    'Connect “Get project” · Output · Response · Project ID to Switch · Input',
    'Connect “Get project” · Output · Response · Project ID to Switch · Gate 1 value',
    'Connect Switch · Gate 1 to Cast · Input',
    'Connect Cast · Result to “Create deployment” · Input · Path · Project reference'
  ];
  for (const [index, connection] of connections.entries()) {
    const after = { ...before, edges: [connection] };
    assert.equal(describe(before, after), expected[index]);
    assert.equal(describe(after, after), 'Save workflow');
    const rewired = structuredClone(after);
    rewired.edges[0] = mapping(connection.id, 'switch', 'other', 'cast', 'value');
    if (index !== 2) describe(after, rewired, /Disconnect /, /Connect Switch · Gate 2 to Cast · Input/);
  }
  const left = operation('legacy-left', 'Get project');
  const right = operation('legacy-right', 'Create deployment');
  delete left.type;
  delete right.type;
  const oldGraph = { ...workflow([left, right]), version: 1 };
  const wired = { ...oldGraph, edges: [{ id: 'legacy-edge', source: left.id, target: right.id }] };
  assert.equal(describe(oldGraph, wired), 'Connect “Get project” to “Create deployment”');
  assert.equal(describe(wired, wired), 'Save workflow');
  assert.equal(describe(wired, oldGraph), 'Disconnect “Get project” to “Create deployment”');
});

Then('workflow change messages suppress connections removed with their nodes', function () {
  const source = branch('get', 'Get project');
  const target = branch('deploy', 'Create deployment');
  const before = workflow([...source.nodes, ...target.nodes], [...source.edges, ...target.edges,
    mapping('linked', 'get-outputs', 'get-outputs-field', 'deploy-inputs', 'deploy-inputs-field')]);
  assert.equal(describe(before, source), 'Remove “Create deployment”');
  assert.equal(describe(before, target), 'Remove “Get project”');
  for (const id of ['get-outputs', 'deploy-inputs']) {
    const after = structuredClone(before);
    after.nodes.find(node => node.id === id).hidden = true;
    after.edges = after.edges.filter(edge => edge.id !== 'linked');
    after.edges.find(edge => edge.id === `schema:${id}`).hidden = true;
    after.edges.find(edge => edge.id === `schema:${id}`).detached = true;
    const message = describe(before, after, /^Hide /);
    assert.doesNotMatch(message, /Disconnect/);
  }
});

Then('workflow change messages explain added removed changed and reordered gates', function () {
  const node = utility('router', 'switch', { gates: [gate('equals', '==', 'yes'), gate('present', 'is_set'), gate('absent', 'is_not_set')] });
  const before = workflow([node]);
  const after = structuredClone(before);
  after.nodes[0].data.gates = [gate('absent', 'is_not_set'), gate('equals', '!=', 'no'), gate('new', '>', '3')];
  const message = describe(before, after, /Change Switch · Gate 2 from Equals “yes” to Does not equal “no”/,
    /Add Switch · Gate 3: Greater than “3”/, /Remove Switch · Gate 2: Is set/, /Reorder gates in Switch/);
  assert.doesNotMatch(message, /router|equals|absent|present/);
  assert.equal(describe(before, before), 'Save workflow');
  const valueOnly = structuredClone(before);
  valueOnly.nodes[0].data.gates[0].value = 'maybe';
  assert.equal(describe(before, valueOnly), 'Change Switch · Gate 1 from Equals “yes” to Equals “maybe”');
});

Then('workflow change messages identify edited comments and replacement nodes', function () {
  const comment = utility('note', 'comment', { text: '' });
  const empty = workflow([comment]);
  const written = workflow([{ ...comment, data: { text: 'Run only after approval.' } }]);
  assert.equal(describe(empty, written), 'Edit comment text to “Run only after approval.”');
  assert.equal(describe(written, empty), 'Edit comment “Run only after approval.” to empty text');
  assert.equal(describe(written, written), 'Save workflow');
  const twoComments = workflow([comment, utility('another-note', 'comment', { text: 'Keep this note.' })]);
  const edited = structuredClone(twoComments);
  edited.nodes[1].data.text = 'Update this note.';
  assert.equal(describe(twoComments, edited), 'Edit comment #2 “Keep this note.” to “Update this note.”');
  assert.equal(describe(empty, workflow([utility('note', 'cast', { targetType: 'Boolean' })])), 'Replace node with Cast');
});

Then('workflow change messages describe field additions removals changes and ordering', function () {
  const before = branch('get', 'Get project');
  before.nodes[1].data.fields.push(field('region', 'Region'), field('environment', 'Environment'));
  const after = structuredClone(before);
  after.nodes[1].data.fields = [{ ...field('environment', 'Environment'), required: true }, field('region', 'Region'), field('new', 'Release name')];
  describe(before, after, /Update field “Get project” · Input · Path · Environment/,
    /Add field “Get project” · Input · Path · Release name/, /Remove field “Get project” · Input · Path · Project reference/,
    /Reorder fields in “Get project” · Input · Path/);
  for (const patch of [{ label: 'Query parameters' }, { direction: 'outputs' }, { notice: 'Parameters unavailable' }, { ownerId: 'other' }]) {
    const base = structuredClone(before);
    base.nodes.push(operation('other', 'Other project'));
    const changed = structuredClone(base);
    Object.assign(changed.nodes[1].data, patch);
    describe(base, changed, /Update /, patch.ownerId ? /Other project/ : /Get project/);
  }
  const withoutPanel = workflow([before.nodes[0]]);
  assert.equal(describe(withoutPanel, workflow(before.nodes.slice(0, 2))), 'Add “Get project” · Input · Path');
  assert.equal(describe(workflow(before.nodes.slice(0, 2)), withoutPanel), 'Remove “Get project” · Input · Path');
  const updatedOperation = structuredClone(before);
  updatedOperation.nodes[0].data.path = '/project/{id}';
  assert.equal(describe(before, updatedOperation), 'Update operation “Get project”');
});

Then('workflow change messages distinguish nested content from canvas preferences', function () {
  const inner = workflow([operation('get', 'Get project')]);
  delete inner.description;
  const middle = workflow([nested('inside', inner)]);
  middle.name = 'Delivery';
  const before = workflow([nested('outer', middle)]);
  const changed = structuredClone(before);
  changed.nodes[0].data.snapshot.nodes[0].data.snapshot.nodes[0].position.x += 12;
  assert.equal(describe(before, changed), 'Update nested workflow “Delivery”');
  const viewOnly = structuredClone(before);
  for (const document of [viewOnly, viewOnly.nodes[0].data.snapshot, viewOnly.nodes[0].data.snapshot.nodes[0].data.snapshot]) {
    document.viewport = { x: 300, y: -10, zoom: 0.75 };
    document.snap = true;
    document.dashed = true;
    document.curved = true;
    document.version = 2;
  }
  assert.equal(describe(before, viewOnly), 'Save workflow');
  const withoutDescription = workflow();
  delete withoutDescription.description;
  assert.equal(describe(withoutDescription, workflow()), 'Save workflow');
  assert.equal(describe(workflow(), withoutDescription), 'Save workflow');
});

Then('workflow change messages tolerate missing display references without exposing IDs', function () {
  // The formatter also reads older history, which can predate complete schema/handle metadata.
  const graph = branch('private-owner', 'Get project');
  const orphan = workflow([graph.nodes[1]]);
  const moved = structuredClone(orphan);
  moved.nodes[0].position.x += 12;
  assert.equal(describe(orphan, moved), 'Move Operation · Input · Path');
  const missingField = { ...graph, edges: [mapping('private-edge', 'private-owner-outputs', 'missing-field', 'private-owner-inputs', 'missing-other')] };
  assert.equal(describe({ ...graph, edges: [] }, missingField), 'Connect “Get project” · Output · Response to “Get project” · Input · Path');
  const missingNode = { ...graph, edges: [mapping('private-edge', 'missing-node', 'missing-field', 'private-owner', 'legacy-handle')] };
  assert.equal(describe({ ...graph, edges: [] }, missingNode), 'Connect Node to “Get project”');
  const unknownGate = workflow([utility('switch', 'switch', { gates: [gate('unknown', 'future-operator', 'yes')] })]);
  const changed = structuredClone(unknownGate);
  changed.nodes[0].data.gates[0].operator = '==';
  assert.equal(describe(unknownGate, changed), 'Change Switch · Gate 1 from future-operator “yes” to Equals “yes”');
});
