// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { defaultProcessingData, processingOperations, processWorkflowValue, processingPointer, validateProcessingData, validateProcessingValue, processingOutputType, processingTypeLabel, processingPreview } from './lib/workflow-processing.ts';
import { encodeWorkflowBinary, workflowBinaryBlob } from './lib/workflow-binary.ts';
import { defaultCsvOptions, parseWorkflowFile, readWorkflowFile } from './lib/workflow-file.ts';
import { createUtilityNode, createOperationGraph, createFileDataGraph, createWorkflowGraph, isWorkflowConnection, insertFileBinaryCast } from './lib/workflow-graph.ts';
import { isWorkflowConnectionTypeCompatible, routingInputTypes } from './lib/workflow-utilities.ts';
import { validateWorkflowDocument, portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { copyWorkflowSelection, pasteWorkflowSelection } from './lib/workflow-clipboard.ts';
import { describeWorkflowChange } from './lib/workflow-change-message.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { operations } from './lib/catalog.ts';
import demo from './catalogs/demo.openapi.json' with { type: 'json' };
import { createWorkflowDemo } from './lib/workflow-demo.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { checkPrivateAssertion, containsPrivateValue, privateExpressionFor, resolvePrivateExpression, validatePrivateExpression } from './lib/secrets/processing.ts';
import { validateVaultVariableInputs, vaultVariablePlaceholder } from './lib/secrets/variables.ts';

const data = (kind, operation, parameters = {}) => ({ ...defaultProcessingData(kind, operation), parameters: { ...defaultProcessingData(kind, operation).parameters, ...parameters } });
const apply = (kind, operation, value, parameters = {}, key) => processWorkflowValue(kind, data(kind, operation, parameters), value, key);
const file = (value, id = 'file') => ({ id, type: 'file', position: { x: 0, y: 0 }, data: { file: parseWorkflowFile('input.json', JSON.stringify(value), defaultCsvOptions) } });
const processNode = (kind, operation, parameters = {}, id = kind) => ({ ...createUtilityNode(kind, { x: 320, y: 0 }, id), data: data(kind, operation, parameters) });
const edge = (source, target, sourceHandle = 'result', targetHandle = 'value', id = `${source}-${sourceHandle}-${target}-${targetHandle}`) => ({ id, kind: 'mapping', source, sourceHandle, target, targetHandle });
const doc = (nodes, edges = []) => ({ version: 3, id: 'processing', name: 'Processing', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
const uuid = '10000000-0000-4000-8000-000000000001';
const secret = 'processing-secret-canary';
const credential = { id: uuid, label: 'Synthetic key', kind: 'secret', value: secret, grants: [] };
const executor = () => ({ process: processWorkflowValue, assertPrivate: (source, configuration) => checkPrivateAssertion(source, configuration, [credential]), dispose() {} });
const project = operations.find(operation => operation.id === 'demo:mockPlainText');
const projectGraph = (id = 'target') => createOperationGraph(project, { x: 700, y: 0 }, id, demo);
const field = (graph, label = 'Request body') => {
  for (const node of graph.nodes) if (node.type === 'data' && node.data.direction === 'inputs') {
    const field = node.data.fields.find(field => field.connectable && field.type === 'Text');
    if (field) return { nodeId: node.id, handle: field.id };
  }
  assert.fail('Missing project input field');
};
function targetDocument(nodes, edges, from, handle = 'result') {
  const graph = projectGraph(), input = field(graph);
  return doc([...nodes, ...graph.nodes], [...edges, ...graph.edges, edge(from, input.nodeId, handle, input.handle)]);
}
const bytes = async value => new Uint8Array(await workflowBinaryBlob(value).arrayBuffer());
const stopNode = () => createUtilityNode('stop', { x: 650, y: 0 }, 'stop');

Then('Stop nodes retain documents clipboard and input-only connection identities', () => {
  const source = file('original'), stop = stopNode(), proposed = edge('file', 'stop', 'value');
  const graph = doc([source, stop], [proposed]);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(graph)), graph);
  assert.deepEqual(portableWorkflowDocument(graph), graph);
  assert.ok(pasteWorkflowSelection(copyWorkflowSelection(graph, ['stop'], []), 32).nodes.some(node => node.type === 'stop'));
  assert.equal(isWorkflowConnection(proposed, graph.nodes, []), true);
  assert.equal(isWorkflowConnection({ ...proposed, targetHandle: 'result' }, graph.nodes, []), false);
  assert.equal(isWorkflowConnection(edge('stop', 'file', 'result'), graph.nodes, []), false);
  const assertion = processNode('assert', 'expect');
  assert.equal(isWorkflowConnection(edge('assert', 'stop', 'failure'), [assertion, stop], []), true);
  assert.match(describeWorkflowChange(doc([]), doc([stop])), /Add.*Stop/);
  assert.match(describeWorkflowChange(doc([source, stop]), graph), /Stop.*Input/);
  assert.throws(() => validateWorkflowDocument(doc([{ ...stop, data: { unknown: true } }])));
  assert.throws(() => validateWorkflowDocument({ ...doc([stop]), version: 2 }));
});

Then('matched assertions stop immediately before another operation is prepared', async () => {
  for (const [expected, active, other] of [['other', 'failure', 'success'], ['original', 'success', 'failure']]) {
    let disposed = 0;
    const graph = targetDocument([stopNode(), file('original'), processNode('assert', 'expect', { operator: 'equals', expected })],
      [edge('file', 'assert', 'value'), edge('assert', 'stop', active)], 'assert', other);
    const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), { ...executor(), dispose() { disposed++; } });
    assert.deepEqual(await runner.nextAsync(), { kind: 'complete', message: 'Workflow stopped.' });
    assert.equal(runner.done, true);
    assert.equal(disposed, 1);
    assert.deepEqual(await runner.nextAsync(), { kind: 'complete', message: 'Workflow stopped.' });
    await assert.rejects(runner.submit({ 'body:$': 'must not send' }), /no operation ready/);
  }
});

Then('unmatched inactive hidden and detached connections never activate Stop', async () => {
  for (const [expected, active, other] of [['original', 'success', 'failure'], ['other', 'failure', 'success']]) {
    const graph = targetDocument([file('original'), processNode('assert', 'expect', { operator: 'equals', expected }), stopNode()],
      [edge('file', 'assert', 'value'), edge('assert', 'stop', other)], 'assert', active);
    const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
    const next = await runner.nextAsync();
    assert.equal(next.values['body:$'], 'original');
    await runner.submit(next.values);
    assert.equal((await runner.nextAsync()).message, 'Workflow complete.');
  }
  const switchNode = { ...createUtilityNode('switch', { x: 300, y: 0 }, 'switch'), data: { gates: [{ id: 'gate-1', operator: '==', value: 'other' }] } };
  const switched = createWorkflowRunner(doc([file('original'), switchNode, stopNode()], [edge('file', 'switch', 'value'), edge('switch', 'stop', 'gate-1')]), undefined, createWorkflowDemo());
  assert.equal((await switched.nextAsync()).message, 'Workflow complete.');
  const hidden = { ...stopNode(), hidden: true };
  assert.equal((await createWorkflowRunner(doc([file('original'), hidden]), undefined, createWorkflowDemo()).nextAsync()).message, 'Workflow complete.');
  for (const [stop, connection] of [[hidden, edge('file', 'stop', 'value')], [stopNode(), { ...edge('file', 'stop', 'value'), detached: true }], [stopNode(), { ...edge('file', 'stop', 'value'), hidden: true }]])
    assert.throws(() => validateWorkflowDocument(doc([file('original'), stop], [connection])));
  assert.equal((await createWorkflowRunner(doc([stopNode()]), undefined, createWorkflowDemo()).nextAsync()).message, 'Workflow complete.');
});

Then('Stop accepts empty falsy binary and private inputs without processing or decryption', async () => {
  const fail = async () => assert.fail('Stop must not compute or decrypt its input');
  for (const source of [0, false, null, '', [], {}, encodeWorkflowBinary('bytes.bin', Uint8Array.of(0, 255))].map(value => file(value)).concat([
    { id: 'vault', type: 'vault', position: { x: 0, y: 0 }, data: { credentialId: uuid } }
  ])) {
    const runner = createWorkflowRunner(doc([source, stopNode()], [edge(source.id, 'stop', 'value')]), undefined, createWorkflowDemo(), { process: fail, assertPrivate: fail, dispose() {} });
    assert.equal((await runner.nextAsync()).message, 'Workflow stopped.');
    assert.deepEqual(runner.processingResults, []);
  }
});

Then('an operation response connected to Stop prevents the following request', async () => {
  const first = projectGraph('first'), second = projectGraph('second'), input = field(second);
  const panel = first.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.fields.some(field => field.connectable && JSON.parse(decodeURIComponent(field.id))[1] === '/body/data'));
  assert.ok(panel, 'The example response exposes its data value');
  const output = panel.data.fields.find(field => field.connectable && JSON.parse(decodeURIComponent(field.id))[1] === '/body/data');
  let requests = 0;
  const demoExecution = createWorkflowDemo();
  const execution = { execute(...args) { requests++; return demoExecution.execute(...args); } };
  const graph = doc([...first.nodes, ...second.nodes, stopNode()], [...first.edges, ...second.edges,
    edge(panel.id, input.nodeId, output.id, input.handle), edge(panel.id, 'stop', output.id)]);
  const runner = createWorkflowRunner(graph, 'first', execution);
  const next = await runner.nextAsync();
  await runner.submit({ ...next.values, 'body:$': 'original' });
  assert.deepEqual(await runner.nextAsync(), { kind: 'complete', message: 'Workflow stopped.' });
  assert.equal(requests, 1);
});

Then('Stop inside a nested workflow ends the complete run', async () => {
  const child = doc([file('original'), stopNode()], [edge('file', 'stop', 'value')]);
  const nested = createWorkflowGraph(child, { x: 0, y: 0 }, 'nested');
  const after = projectGraph('after');
  const runner = createWorkflowRunner(doc([...nested.nodes, ...after.nodes], [...nested.edges, ...after.edges]), 'nested', createWorkflowDemo());
  assert.deepEqual(await runner.nextAsync(), { kind: 'complete', message: 'Workflow stopped.' });
  assert.equal(runner.done, true);
});

Then('workflow encoders preserve UTF-8 Base64 Base64url and hexadecimal values', async () => {
  const input = '🙂é', expected = Uint8Array.of(240, 159, 153, 130, 195, 169);
  const binary = await apply('transform', 'utf8_encode', input);
  assert.deepEqual(await bytes(binary), expected);
  assert.equal(await apply('transform', 'utf8_decode', binary), input);
  for (const [encoding, encoded] of [['base64', '8J+ZgsOp'], ['base64url', '8J-ZgsOp'], ['hex', 'f09f9982c3a9']]) {
    assert.equal(await apply('transform', `${encoding}_encode`, input), encoded);
    assert.equal(await apply('transform', `${encoding}_encode`, binary), encoded);
    assert.deepEqual(await bytes(await apply('transform', `${encoding}_decode`, encoded)), expected);
    assert.deepEqual(await bytes(await apply('transform', `${encoding}_decode`, '')), new Uint8Array());
  }
  assert.equal(await apply('transform', 'base64_encode', 'f'), 'Zg==');
  assert.equal(await apply('transform', 'base64url_encode', 'f'), 'Zg');
  assert.deepEqual(await bytes(await apply('transform', 'hex_decode', 'FF00')), Uint8Array.of(255, 0));
});

Then('workflow translation parses serializes selects and maps data without mutation', async () => {
  const original = { profile: { id: 42, name: 'Alice' }, 'a/b': { '~name': 'escaped' } };
  const before = structuredClone(original);
  assert.deepEqual(await apply('transform', 'json_parse', JSON.stringify(original)), original);
  assert.equal(await apply('transform', 'json_stringify', original), JSON.stringify(original));
  assert.equal(await apply('filter', 'select_field', original, { path: '/profile/id', type: 'Number' }), 42);
  assert.equal(await apply('filter', 'select_field', original, { path: '/a~1b/~0name' }), 'escaped');
  assert.deepEqual(await apply('transform', 'map_fields', original, { fields: '{"userId":"/profile/id","label":"/profile/name"}' }), { userId: 42, label: 'Alice' });
  const mapped = await apply('transform', 'map_fields', original, { fields: '{"__proto__":"/profile/id"}' });
  assert.equal(Object.hasOwn(mapped, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(mapped), Object.prototype);
  assert.deepEqual(original, before);
  for (const value of [[], null, 42, false, 'text'])
    assert.deepEqual(await apply('transform', 'json_parse', JSON.stringify(value)), value);
  assert.equal(processingPointer(original, '/constructor'), undefined);
  assert.equal(await apply('transform', 'json_parse', '1.5'), 1.5);
});

Then('Select field is a Filter while old Transform nodes and private recipes preserve their behavior', async () => {
  assert.equal(processingOperations.find(operation => operation.id === 'select_field').kind, 'filter');
  const configuration = data('filter', 'select_field', { path: '/profile/name' });
  assert.throws(() => validateProcessingData('assert', configuration), /Unknown processing operation/);
  assert.throws(() => validateProcessingData('filter', data('transform', 'json_parse')), /Unknown processing operation/);
  const selection = { ...processNode('filter', 'select_field', { path: '/profile/name' }, 'selection'), type: 'transform' };
  const graph = targetDocument([file({ profile: { name: 'Alice' } }), selection], [edge('file', 'selection', 'value')], 'selection');
  const before = structuredClone(graph);
  const restored = parseWorkflowDocument(JSON.stringify(graph));
  const migrated = restored.nodes.find(node => node.id === 'selection');
  assert.equal(migrated.type, 'filter');
  assert.deepEqual(migrated, { ...selection, type: 'filter' });
  assert.deepEqual(restored.edges, graph.edges);
  assert.deepEqual(graph, before);
  assert.deepEqual(portableWorkflowDocument(graph), restored);
  const pasted = pasteWorkflowSelection(copyWorkflowSelection(graph, ['selection'], []), 32);
  assert.equal(validateWorkflowDocument(doc(pasted.nodes, pasted.edges)).nodes[0].type, 'filter');
  const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
  const next = await runner.nextAsync();
  assert.equal(next.values['body:$'], 'Alice');
  assert.ok(next.mappedFields.includes('body:$'));
  runner.end();
  const parsed = { kind: 'process', type: 'transform', data: data('transform', 'json_parse'), value: { kind: 'credential', id: uuid } };
  for (const type of ['transform', 'filter']) {
    const expression = { kind: 'process', type, data: configuration, value: parsed };
    assert.equal(await resolvePrivateExpression(expression, [{ ...credential, value: '{"profile":{"name":"Alice"}}' }]), 'Alice');
  }
  assert.equal(await apply('filter', 'select_field', [{ value: 42 }], { path: '/0/value', type: 'Number' }), 42);
  await assert.rejects(apply('filter', 'select_field', { value: 'text' }, { path: '/value', type: 'Number' }), /selected Number output type/);
});

Then('Parse JSON accepts every JSON type and restores old selected types without narrowing output', async () => {
  const configuration = data('transform', 'json_parse');
  assert.deepEqual(configuration.parameters, {});
  assert.equal(processingTypeLabel(processingOutputType('transform', configuration, 'Text')), 'Object | Text | Number | Boolean | Array | Null');
  for (const value of [{ answer: 42 }, [], [false, null], 'text', '', 42, 1.5, false, true, null])
    assert.deepEqual(await processWorkflowValue('transform', configuration, JSON.stringify(value)), value);
  for (const type of ['Object', 'Array', 'Text', 'Number', 'Boolean', 'Null']) {
    const legacy = { ...configuration, parameters: { type } };
    const original = structuredClone(legacy);
    assert.deepEqual(validateProcessingData('transform', legacy), configuration);
    assert.equal(await processWorkflowValue('transform', legacy, 'false'), false);
    assert.deepEqual(legacy, original, 'Normalizing a stored node must not mutate its source.');
    const graph = doc([{ ...processNode('transform', 'json_parse'), data: legacy }]);
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(graph)).nodes[0].data, configuration);
    assert.deepEqual(portableWorkflowDocument(graph).nodes[0].data, configuration);
    const pasted = pasteWorkflowSelection(copyWorkflowSelection(graph, ['transform'], []), 32);
    assert.deepEqual(validateWorkflowDocument(doc(pasted.nodes, pasted.edges)).nodes[0].data, configuration);
  }
  for (const parameters of [{ type: 'Binary' }, { type: 'Unknown' }, { type: 42 }, { type: 'Object', extra: '' }])
    assert.throws(() => validateProcessingData('transform', { ...configuration, parameters }), /Invalid processing parameters/);
  await assert.rejects(processWorkflowValue('transform', configuration, '1e400'), /finite JSON/);
});

Then('known JSON alternatives connect to matching ports and retain their types through routing', () => {
  const parse = processNode('transform', 'json_parse');
  const types = ['Object', 'Array', 'Text', 'Number', 'Integer', 'Boolean', 'Null', 'Binary'];
  const ports = { id: 'ports', type: 'data', position: { x: 900, y: 0 }, data: { ownerId: 'target', direction: 'inputs', label: 'Inputs',
    fields: types.map(type => ({ id: type, label: type, type, connectable: true, required: false, description: '' })) } };
  const assertion = processNode('assert', 'expect');
  const switched = createUtilityNode('switch', { x: 600, y: 0 }, 'switch');
  const cast = createUtilityNode('cast', { x: 600, y: 300 }, 'cast');
  const trim = processNode('filter', 'trim');
  const arrayRange = processNode('filter', 'array_range', {}, 'range');
  const binary = processNode('transform', 'utf8_decode', {}, 'binary');
  const unknown = processNode('filter', 'select_field', { type: 'Unknown' }, 'unknown');
  const nodes = [parse, ports, assertion, switched, cast, trim, arrayRange, binary, unknown];
  for (const [source, handle, edges] of [['transform', 'result', []], ['assert', 'success', [edge('transform', 'assert')]],
    ['assert', 'failure', [edge('transform', 'assert')]], ['switch', 'gate-1', [edge('transform', 'switch')]]])
    for (const type of types)
      assert.equal(isWorkflowConnection(edge(source, 'ports', handle, type), nodes, edges), type !== 'Binary', `${source}/${handle} → ${type}`);
  const routes = [edge('transform', 'assert'), edge('assert', 'switch', 'success'), edge('switch', 'cast', 'gate-1')];
  const inferred = routingInputTypes(nodes, routes);
  for (const id of ['assert', 'switch', 'cast']) assert.equal(inferred.get(id), 'JSON', id);
  for (const target of ['filter', 'range', 'cast', 'assert', 'switch'])
    assert.equal(isWorkflowConnection(edge('transform', target), nodes, []), true, target);
  assert.equal(isWorkflowConnection(edge('transform', 'binary'), nodes, []), false);
  assert.equal(isWorkflowConnection(edge('unknown', 'filter'), nodes, []), false, 'Unknown must not become a wildcard.');
  const downstream = [edge('assert', 'ports', 'success', 'Object')];
  assert.equal(isWorkflowConnection(edge('transform', 'assert'), nodes, downstream), true);
  const textOnly = nodes.map(node => node.id === 'transform' ? processNode('transform', 'base64_encode') : node);
  assert.equal(isWorkflowConnection(edge('transform', 'assert'), textOnly, downstream), false, 'Downstream type checks remain active.');
});

Then('parsed values satisfy receiving inputs at runtime without casting and stay private in vault recipes', async () => {
  for (const value of ['hello', 42, false, {}, [], null]) {
    const graph = targetDocument([file(JSON.stringify(value)), processNode('transform', 'json_parse')],
      [edge('file', 'transform', 'value')], 'transform');
    const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
    if (typeof value === 'string') {
      const next = await runner.nextAsync();
      assert.equal(next.values['body:$'], value);
      assert.ok(next.mappedFields.includes('body:$'));
    } else await assert.rejects(runner.nextAsync(), /needs a string value/);
    runner.end();
  }
  await assert.rejects(apply('filter', 'trim', await apply('transform', 'json_parse', '{}')), /does not accept Object/);
  const configuration = data('transform', 'json_parse', { type: 'Object' });
  const expression = { kind: 'process', type: 'transform', data: configuration, value: { kind: 'credential', id: uuid } };
  const privateCredential = { ...credential, value: JSON.stringify('private-json-value') };
  assert.deepEqual(validatePrivateExpression(expression).data.parameters, {});
  assert.equal(await resolvePrivateExpression(expression, [privateCredential]), 'private-json-value');
  assert.equal(await checkPrivateAssertion(expression, data('assert', 'expect', { operator: 'is_type', expected: 'text' }), [privateCredential]), true);
  assert.ok(!JSON.stringify(expression).includes('private-json-value'));
});

Then('workflow cryptographic transforms match SHA256 HMAC and signed JWT contracts', async () => {
  assert.equal(await apply('transform', 'sha256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const hmacKey = encodeWorkflowBinary('key.bin', new Uint8Array(20).fill(11));
  assert.equal(await apply('transform', 'hmac_sha256', 'Hi There', {}, hmacKey), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  const payload = { sub: '1234567890', name: 'John Doe', iat: 1516239022 };
  const key = '01234567890123456789012345678901';
  const jwt = await apply('transform', 'jwt_sign', payload, {}, key);
  const prefix = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';
  assert.equal(jwt, `${prefix}.${createHmac('sha256', key).update(prefix).digest('base64url')}`);
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
  const signed = await apply('transform', 'jwt_sign', payload, { algorithm: 'RS256', key_id: 'fresh-test-key' }, pem);
  const [header, claims, signature] = signed.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'fresh-test-key' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), payload);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`)), true);
  const der = encodeWorkflowBinary('key.der', new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)));
  assert.equal(await apply('transform', 'jwt_sign', payload, { algorithm: 'RS256', key_id: 'fresh-test-key' }, der), signed);
  const weak = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const weakDer = encodeWorkflowBinary('weak.der', new Uint8Array(await crypto.subtle.exportKey('pkcs8', weak.privateKey)));
  await assert.rejects(apply('transform', 'jwt_sign', {}, { algorithm: 'RS256' }, weakDer), /2048/);
});

Then('workflow filters trim slice and select values with explicit predicates', async () => {
  for (const [side, expected] of [['both', 'a'], ['start', 'a  '], ['end', '  a']]) assert.equal(await apply('filter', 'trim', '  a  ', { side }), expected);
  assert.equal(await apply('filter', 'substring', 'a🙂éb', { start: '1', end: '3' }), '🙂é');
  assert.equal(await apply('filter', 'substring', 'a🙂éb', { start: '-2' }), 'éb');
  assert.equal(await apply('filter', 'substring', 'abc', { start: '', end: '1' }), 'a');
  const input = [{ id: 1, active: false }, { id: 2, active: true }, { id: 3, active: true }];
  assert.deepEqual(await apply('filter', 'array_range', input, { start: '1', end: '-1' }), [input[1]]);
  assert.deepEqual(await apply('filter', 'array_filter', input, { path: '/active', operator: 'equals', expected: 'true' }), input.slice(1));
  assert.deepEqual(await apply('filter', 'array_filter', input, { path: '/id', operator: 'greater_than', expected: '3' }), []);
  for (const [operator, value, expected, match] of [['equals', { b: 2, a: 1 }, '{"a":1,"b":2}', true], ['not_equal', 1, '"1"', true],
    ['at_least', 2, '2', true], ['less_than', 2, '3', true], ['at_most', 2, '2', true], ['greater_than', '2', '1', false],
    ['contains', ['a', 'b'], 'a', true], ['contains', 'hello', 'ell', true], ['starts_with', 'hello', 'he', true], ['ends_with', 'hello', 'lo', true],
    ['is_set', false, '', true], ['is_not_set', null, '', true], ['is_type', 1, 'number', true],
    ['equals', [1, { a: true }], '[1,{"a":true}]', true], ['equals', [1], '[1,2]', false], ['equals', [], '{}', false],
    ['equals', [1], '[2]', false], ['is_not_set', 1, '', false]])
    assert.equal(await apply('assert', 'expect', value, { operator, expected }), match, operator);
  assert.equal(await apply('assert', 'expect', {}, { path: '/missing', operator: 'is_not_set' }), true);
  assert.equal(await apply('assert', 'expect', {}, { path: '/missing', operator: 'is_type', expected: 'unknown' }), true);
});

Then('workflow processing rejects malformed configuration values encodings and limits', async () => {
  for (const invalid of [null, {}, { ...data('transform', 'base64_encode'), version: 2 }, { ...data('transform', 'base64_encode'), extra: true },
    { ...data('transform', 'base64_encode'), operation: 'user_code' }, { ...data('filter', 'trim'), parameters: {} },
    { ...data('filter', 'trim'), parameters: { side: 'unknown' } }, { ...data('filter', 'trim'), parameters: { side: 'both', extra: '' } },
    { ...data('filter', 'trim'), parameters: { side: 42 } }, { ...data('filter', 'trim'), parameters: { invalid: 'both' } },
    { ...data('filter', 'trim'), parameters: { side: 'x'.repeat(4097) } }])
    assert.throws(() => validateProcessingData(processingOperations.find(item => item.id === invalid?.operation)?.kind ?? 'transform', invalid));
  for (const [kind, operation, input, parameters, key] of [
    ['transform', 'base64_decode', 'Zh=='], ['transform', 'base64_decode', 'Zg'], ['transform', 'base64_decode', 'Zg==\n'],
    ['transform', 'base64url_decode', 'Zh'], ['transform', 'base64url_decode', '+/=='], ['transform', 'base64url_decode', 'x'],
    ['transform', 'hex_decode', 'a'], ['transform', 'hex_decode', 'gg'], ['transform', 'utf8_decode', encodeWorkflowBinary('bad.bin', Uint8Array.of(255))],
    ['transform', 'utf8_encode', 42], ['transform', 'json_parse', 'invalid'],
    ['filter', 'select_field', {}, { path: '/missing' }], ['filter', 'select_field', {}, { path: 'invalid' }], ['filter', 'select_field', {}, { path: '/~2' }],
    ['transform', 'map_fields', {}, { fields: 'invalid' }], ['transform', 'map_fields', {}, { fields: '[]' }], ['transform', 'map_fields', {}, { fields: '{"a":1}' }],
    ['transform', 'map_fields', {}, { fields: '{"a":"/missing"}' }], ['filter', 'substring', 'a', { start: '1.5' }], ['filter', 'array_range', [], { end: 'a' }],
    ['transform', 'hmac_sha256', 'input', {}, null], ['transform', 'jwt_sign', {}, { algorithm: 'RS256' }, 'not a PEM key'],
    ['transform', 'jwt_sign', {}, {}, 'weak-key'],
    ['transform', 'sha256', 'a'.repeat(500001)], ['transform', 'hex_decode', 'a'.repeat(1000002)],
    ['transform', 'base64_decode', 'AAAA'.repeat(166668)],
  ]) await assert.rejects(apply(kind, operation, input, parameters, key), undefined, `${kind}/${operation}`);
  for (const invalid of [undefined, Infinity, Symbol('bad'), { get value() { throw new Error('Accessor executed'); } }, new Date(), new Array(20001).fill(0)])
    assert.throws(() => validateProcessingValue(invalid));
  assert.ok(processingPreview(new Array(500).fill('x'.repeat(500))).length <= 3000);
  assert.match(processingPreview({ answer: 42, list: [true, null] }), /42/);
  assert.throws(() => validateProcessingValue({ left: 'a'.repeat(600000), right: 'b'.repeat(600000) }), /size limit/);
});

Then('processing graphs retain independent node types configuration and meaningful changes', () => {
  const graph = doc([file('abc'), processNode('transform', 'base64_encode'), processNode('filter', 'substring'), processNode('assert', 'expect')],
    [edge('file', 'transform', 'value'), edge('transform', 'filter'), edge('filter', 'assert')]);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(graph)), validateWorkflowDocument(graph));
  assert.deepEqual(portableWorkflowDocument(graph), graph);
  const changed = structuredClone(graph); changed.nodes[1].data = data('transform', 'sha256');
  assert.match(describeWorkflowChange(graph, changed), /Configure.*SHA-256/);
  assert.equal(routingInputTypes(graph.nodes, graph.edges).get('filter'), 'Text');
  assert.equal(processingOutputType('assert', data('assert', 'expect'), 'Object'), 'Object');
  assert.equal(isWorkflowConnectionTypeCompatible(edge('file', 'transform', 'value'), graph.nodes, []), true);
  const wrong = doc([file(42), processNode('filter', 'trim')]);
  assert.equal(isWorkflowConnectionTypeCompatible(edge('file', 'filter', 'value'), wrong.nodes, []), false);
  assert.throws(() => validateWorkflowDocument({ ...graph, nodes: graph.nodes.map(node => node.type === 'transform' ? { ...node, data: { ...node.data, version: 99 } } : node) }));
  const clipboard = copyWorkflowSelection(graph, graph.nodes.map(node => node.id), []);
  assert.ok(clipboard);
  const pasted = pasteWorkflowSelection(clipboard, 1000);
  assert.ok(pasted.nodes.some(node => node.type === 'assert'));
});

Then('a failed assertion forwards its input through Failure without an error', async () => {
  const graph = targetDocument([file('original'), processNode('assert', 'expect', { operator: 'equals', expected: 'other' })], [edge('file', 'assert', 'value')], 'assert', 'failure');
  const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
  const next = await runner.nextAsync();
  assert.equal(next.values['body:$'], 'original');
  assert.ok(next.mappedFields.includes('body:$'));
  await runner.submit({ ...next.values });
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.equal(runner.processingResults[0].matched, false);
});

Then('binary processing connections insert the original file cast and decode exact bytes', async () => {
  const uploaded = readWorkflowFile('input.json', new TextEncoder().encode('"original"'));
  const nodes = [{ ...file('original'), data: { file: uploaded } }, processNode('transform', 'utf8_decode')];
  const proposed = edge('file', 'transform', 'value');
  const graph = insertFileBinaryCast(proposed, nodes, [], 'binary-cast');
  assert.ok(graph);
  assert.equal(graph.nodes.find(node => node.id === 'binary-cast').type, 'cast');
  const runner = createWorkflowRunner(doc(graph.nodes, graph.edges), undefined, createWorkflowDemo(), executor());
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.equal(runner.processingResults[0].preview, JSON.stringify('"original"'));
});

Then('assertion outcomes leave unmatched connected fields available for manual input', async () => {
  for (const [expected, output] of [['other', 'success'], ['original', 'failure']]) {
    const graph = targetDocument([file('original'), processNode('assert', 'expect', { operator: 'equals', expected }), processNode('filter', 'trim')],
      [edge('file', 'assert', 'value'), edge('assert', 'filter', output)], 'filter');
    const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
    const next = await runner.nextAsync();
    assert.equal(next.kind, 'operation');
    assert.equal(next.mappedFields.includes('body:$'), false);
    assert.equal(next.values['body:$'], undefined);
    await runner.submit({ ...next.values, 'body:$': 'Manual value' });
    assert.equal((await runner.nextAsync()).kind, 'complete');
  }
});

Then('processing chains produce real values and support operation-free runs', async () => {
  const graph = targetDocument([file('  abc  '), processNode('filter', 'trim'), processNode('transform', 'sha256')],
    [edge('file', 'filter', 'value'), edge('filter', 'transform')], 'transform');
  const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
  const next = await runner.nextAsync();
  assert.equal(next.values['body:$'], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const standalone = createWorkflowRunner(doc([file('abc'), processNode('transform', 'base64_encode')], [edge('file', 'transform', 'value')]), undefined, createWorkflowDemo(), executor());
  assert.equal((await standalone.nextAsync()).kind, 'complete');
  assert.match(standalone.processingResults[0].preview, /YWJj/);
});

Then('workflow processing shares concurrent advancement and rejects cancelled results', async () => {
  let release, calls = 0, disposed = 0;
  const engine = { ...executor(), process: async () => { calls++; return new Promise(resolve => { release = resolve; }); }, dispose() { disposed++; } };
  const runner = createWorkflowRunner(doc([file('abc'), processNode('transform', 'base64_encode')], [edge('file', 'transform', 'value')]), undefined, createWorkflowDemo(), engine);
  const first = runner.nextAsync(), second = runner.nextAsync();
  assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  runner.end(); release('YWJj');
  await assert.rejects(first);
  assert.equal(runner.processingResults.length, 0);
  assert.ok(disposed);
  const cancelled = createWorkflowRunner(doc([file('abc'), processNode('transform', 'base64_encode')], [edge('file', 'transform', 'value')]), undefined, createWorkflowDemo());
  const loading = cancelled.nextAsync();
  cancelled.end();
  await assert.rejects(loading, /cancelled/);
  assert.equal(cancelled.processingResults.length, 0);
});

Then('array processing keeps file columns whole while text filters retain item types', async () => {
  const source = file([{ label: 'first' }, { label: 'second' }]);
  const projected = createFileDataGraph(source);
  const panel = projected.nodes.find(node => node.data.fields.some(field => field.label === 'label'));
  const column = panel.data.fields.find(field => field.label === 'label');
  const range = processNode('filter', 'array_range', { start: '1' });
  const connection = edge(panel.id, range.id, column.id);
  const nodes = [source, ...projected.nodes, range], edges = [...projected.edges, connection];
  assert.equal(isWorkflowConnection(connection, nodes, projected.edges), true);
  assert.equal(routingInputTypes(nodes, edges).get(range.id), 'Array');
  const runner = createWorkflowRunner(doc(nodes, edges), undefined, createWorkflowDemo(), executor());
  assert.equal((await runner.nextAsync()).kind, 'complete');
  assert.deepEqual(JSON.parse(runner.processingResults[0].preview), ['second']);
  const textFilter = { ...range, data: data('filter', 'trim') };
  assert.equal(routingInputTypes([source, ...projected.nodes, textFilter], edges).get(range.id), 'Text');
});

Then('private processing recipes inject transformed values and redact derived secrets', async () => {
  const source = { id: 'vault', type: 'vault', position: { x: 0, y: 0 }, data: { credentialId: uuid } };
  const graph = targetDocument([source, processNode('transform', 'base64_encode')], [edge('vault', 'transform', 'value')], 'transform');
  let sent;
  const execution = { async execute(operation, values, signal, context) {
    const descriptor = await approvedOperation(operation, 'https://example.com');
    return executeCredentialed(descriptor, values, context.binding, [credential], { assertCurrent() {}, variables: context.variables, signal,
      fetchRequest: async (_url, init) => { sent = init.body; return Response.json({ ok: true }); } });
  } };
  const runner = createWorkflowRunner(graph, 'target', execution, executor());
  const next = await runner.nextAsync();
  assert.equal(next.values['body:$'], vaultVariablePlaceholder);
  assert.equal(next.vaultVariables[0].credentialId, undefined);
  assert.ok(next.vaultVariables[0].expression);
  const publicState = JSON.stringify([next, runner.processingResults]);
  assert.ok(!publicState.includes(secret));
  await runner.submit(next.values);
  const encoded = Buffer.from(secret).toString('base64');
  assert.equal(sent, encoded);
  assert.ok(!JSON.stringify(runner.processingResults).includes(encoded));
  const descriptor = await approvedOperation(project, 'https://example.com');
  const reflected = await executeCredentialed(descriptor, { 'body:$': vaultVariablePlaceholder }, { fingerprint: descriptor.fingerprint, alternative: 0, credentials: {} }, [credential],
    { assertCurrent() {}, variables: next.vaultVariables, fetchRequest: async () => Response.json({ reflected: encoded, key: secret }) });
  assert.ok(!JSON.stringify(reflected).includes(encoded));
  assert.ok(!JSON.stringify(reflected).includes(secret));
  assert.equal((await runner.nextAsync()).kind, 'complete');
});

Then('private assertions preserve opaque original references and allow manual fallback', async () => {
  const source = { id: 'vault', type: 'vault', position: { x: 0, y: 0 }, data: { credentialId: uuid } };
  for (const [expected, output, mapped] of [[secret, 'success', true], ['other', 'failure', true], ['other', 'success', false]]) {
    const graph = targetDocument([source, processNode('assert', 'expect', { operator: 'equals', expected })], [edge('vault', 'assert', 'value')], 'assert', output);
    const runner = createWorkflowRunner(graph, 'target', createWorkflowDemo(), executor());
    const next = await runner.nextAsync();
    assert.equal(next.mappedFields.includes('body:$'), mapped);
    assert.ok(!JSON.stringify(runner.processingResults).includes(secret));
    if (mapped) assert.equal(next.vaultVariables[0].credentialId, uuid);
    runner.end();
  }
});

Then('private processing rejects unknown recipes invalid references and structure limits', async () => {
  const expression = { kind: 'process', type: 'transform', data: data('transform', 'base64_encode'), value: { kind: 'credential', id: uuid } };
  assert.equal(await resolvePrivateExpression(expression, [credential]), Buffer.from(secret).toString('base64'));
  assert.equal(await checkPrivateAssertion({ kind: 'credential', id: uuid }, data('assert', 'expect', { operator: 'is_set' }), [credential]), true);
  for (const invalid of [null, [], { kind: 'credential', id: 'bad' }, { ...expression, extra: true }, { ...expression, type: 'eval' },
    { kind: 'literal' }, { kind: 'array', items: {} }, { kind: 'object', entries: [] }, { kind: 'process', type: 'transform', data: {}, value: {} }])
    assert.throws(() => validatePrivateExpression(invalid));
  await assert.rejects(resolvePrivateExpression(expression, []), { code: 'PERMISSION' });
  await assert.rejects(resolvePrivateExpression({ ...expression, value: { kind: 'literal', value: 42 } }, [credential]), { code: 'INVALID' });
  const wrapped = { kind: 'object', entries: { value: { kind: 'array', items: [expression, { kind: 'literal', value: 'public' }] } } };
  assert.deepEqual(await resolvePrivateExpression(wrapped, [credential]), { value: [Buffer.from(secret).toString('base64'), 'public'] });
  assert.ok(validateVaultVariableInputs([{ key: 'body:$', path: [], expression }])[0].expression);
  assert.throws(() => validateVaultVariableInputs([{ key: 'body:$', path: [], credentialId: uuid, expression }]));
  let nested = expression; for (let index = 0; index < 26; index++) nested = { kind: 'array', items: [nested] };
  assert.throws(() => validatePrivateExpression(nested));
  await assert.rejects(checkPrivateAssertion({ kind: 'credential', id: uuid }, data('assert', 'expect'), []), { code: 'PERMISSION' });
  await assert.rejects(checkPrivateAssertion(expression, { ...data('assert', 'expect'), operation: 'user_code' }, [credential]), { code: 'INVALID' });
});

Then('mixed private processing preserves nested references and keyed operations', async () => {
  const token = 'test-run';
  const reference = { vaultVariable: uuid, referenceToken: token };
  const encoded = { referenceToken: token, vaultProcessing: { kind: 'process', type: 'transform', data: data('transform', 'base64_encode'), value: { kind: 'credential', id: uuid } } };
  const value = { list: [reference, 'public'], encoded };
  assert.equal(containsPrivateValue(value, token), true);
  assert.equal(containsPrivateValue(value, 'another-run'), false);
  const expression = privateExpressionFor(value, token);
  assert.deepEqual(await resolvePrivateExpression(expression, [credential]), { list: [secret, 'public'], encoded: Buffer.from(secret).toString('base64') });
  const keyed = { kind: 'process', type: 'transform', data: data('transform', 'hmac_sha256', { format: 'base64url' }), value: { kind: 'literal', value: 'message' }, key: { kind: 'credential', id: uuid } };
  assert.equal(await resolvePrivateExpression(keyed, [credential]), createHmac('sha256', secret).update('message').digest('base64url'));
  let deep = 1; for (let index = 0; index < 42; index++) deep = { nested: deep };
  assert.throws(() => containsPrivateValue(deep, token), /structure limit/);
});

Then('private processing bounds recipes and derived result retention', async () => {
  assert.throws(() => validatePrivateExpression({ kind: 'literal', value: 'x'.repeat(1000001) }), { code: 'LIMIT' });
  const publicValues = Array.from({ length: 10001 }, (_, i) => `value-${i}`);
  const excessive = { kind: 'object', entries: { public: { kind: 'literal', value: publicValues }, private: { kind: 'credential', id: uuid } } };
  await assert.rejects(resolvePrivateExpression(excessive, [credential]), { code: 'LIMIT' });
  const credentials = Array.from({ length: 260 }, (_, i) => ({ ...credential,
    id: `10000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`, value: `${i}.`.padEnd(16000, 'a') }));
  await assert.rejects(resolvePrivateExpression({ kind: 'array', items: credentials.map(credential => ({ kind: 'credential', id: credential.id })) }, credentials), { code: 'LIMIT' });
  let nested = 'end'; for (let i = 0; i < 39; i++) nested = { nested };
  const nestedCredential = { ...credential, value: JSON.stringify(nested) };
  let parsed = { kind: 'process', type: 'transform', data: data('transform', 'json_parse'), value: { kind: 'credential', id: uuid } };
  for (let i = 0; i < 3; i++) parsed = { kind: 'array', items: [parsed] };
  await assert.rejects(resolvePrivateExpression(parsed, [nestedCredential]), { code: 'LIMIT' });
});
