// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { After, Before, Then } from '@cucumber/cucumber';
import { operations, updateCatalogs } from './lib/catalog.ts';
import { catalogs, bundledCatalogs } from './lib/catalog-registry.ts';
import { validateSchemaDocument } from './lib/schema-documents.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { createWorkflowExecution, createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { createOperationGraph, createWorkflowGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument, validateWorkflowDocument } from './lib/workflow-document.ts';
import { validateCredentialBinding, validateCredentialContext } from './lib/secrets/bindings.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { VaultError } from './lib/secrets/types.ts';

const code = expected => error => error instanceof VaultError && error.code === expected;
const origin = 'https://integration.example/v1';
const response = { description: 'Success', content: { 'application/json': { schema: { type: 'object', properties: { result: { type: 'string' } } } } } };
const binding = (fingerprint = 'a'.repeat(64), id = crypto.randomUUID(), alternative = 0) =>
  ({ alternative, fingerprint, credentials: { bearer: id } });
const invocation = selection => ({ binding: selection, runId: crypto.randomUUID(), nodeId: 'direct' });
function schema() {
  return { openapi: '3.1.0', info: { title: 'Vault integration', version: '1' }, servers: [{ url: origin }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }], paths: {
      '/secured': { get: { operationId: 'secured', responses: { 200: response },
        parameters: [{ name: 'label', in: 'query', schema: { type: 'string' } }] } },
      '/optional': { get: { operationId: 'optional', security: [{ bearer: [] }, {}], responses: { 200: response } } },
      '/public': { get: { operationId: 'public', security: [], responses: { 200: response } } },
    } };
}
function register(document = schema()) {
  const parsed = validateSchemaDocument(document, 'vault-integration');
  const catalog = { id: 'vault-integration', file: 'vault-integration.json', name: parsed.name, document: parsed.document,
    groups: parsed.groups, execution: { kind: 'http', origin: parsed.serverUrl } };
  updateCatalogs([...bundledCatalogs, catalog]);
  return catalog;
}
const operation = name => operations.find(item => item.id === `vault-integration:${name}`);
const result = (operation, values, extra = {}) => ({ request: prepareRequest(operation, values),
  response: { status: 200, statusText: 'OK', headers: {}, body: { result: 'safe result' }, ...extra } });
const operationNode = (id, selected, name = 'secured') => ({ id, type: 'operation', position: { x: 0, y: 0 }, data: {
  operationId: operation(name).id, name: 'Read service', description: '', method: 'GET', path: operation(name).path,
  ...(selected ? { credentialBinding: selected } : {}),
} });
const workflow = (nodes, edges = [], id = 'vault-workflow') => ({ version: 3, id, name: 'Credential workflow', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
const nested = (id, snapshot) => ({ id, type: 'workflow', position: { x: 0, y: 0 }, data: {
  workflowId: snapshot.id, name: 'Nested credential workflow', description: '', snapshot,
} });

Before({ tags: '@vault-integration' }, function () { this.integrationCatalogs = catalogs; this.integrationFetch = globalThis.fetch; });
After({ tags: '@vault-integration' }, function () { updateCatalogs(this.integrationCatalogs); globalThis.fetch = this.integrationFetch; });

Then('credential bindings and invocation contexts reject inherited accessor and malformed fields without invoking getters', () => {
  const valid = binding(), parsed = validateCredentialBinding(valid);
  assert.deepEqual(parsed, valid); assert.notEqual(parsed, valid); assert.notEqual(parsed.credentials, valid.credentials);
  parsed.credentials.bearer = crypto.randomUUID(); assert.notEqual(parsed.credentials.bearer, valid.credentials.bearer);
  assert.deepEqual(validateCredentialBinding({ ...valid, alternative: 31, credentials: {} }), { ...valid, alternative: 31, credentials: {} });
  assert.deepEqual(validateCredentialBinding(Object.assign(Object.create(null), valid)), valid);
  const malformed = [null, [], 'binding', Object.create(valid), { ...valid, extra: true },
    { credentials: valid.credentials, fingerprint: valid.fingerprint }, { ...valid, alternative: -1 },
    { ...valid, alternative: 32 }, { ...valid, alternative: 0.5 }, { ...valid, fingerprint: 'wrong' },
    { ...valid, credentials: Object.create(valid.credentials) }, { ...valid, credentials: [] },
    { ...valid, credentials: { bearer: 'not a UUID' } }, { ...valid, credentials: { bearer: 42 } },
    { ...valid, credentials: { ' ': crypto.randomUUID() } }, { ...valid, credentials: { ['a'.repeat(129)]: crypto.randomUUID() } },
    { ...valid, credentials: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`scheme${index}`, crypto.randomUUID()])) },
  ];
  for (const value of malformed) assert.throws(() => validateCredentialBinding(value), code('INVALID'));
  let calls = 0;
  const access = { ...valid };
  Object.defineProperty(access, 'fingerprint', { enumerable: true, get() { calls++; return valid.fingerprint; } });
  const credentials = {};
  Object.defineProperty(credentials, 'bearer', { enumerable: true, get() { calls++; return valid.credentials.bearer; } });
  const hidden = { ...valid }; Object.defineProperty(hidden, 'fingerprint', { enumerable: false });
  const symbol = { ...valid }; symbol[Symbol('unexpected')] = true;
  for (const value of [access, { ...valid, credentials }, hidden, symbol]) assert.throws(() => validateCredentialBinding(value), code('INVALID'));
  assert.equal(calls, 0);
  const context = invocation(valid);
  assert.deepEqual(validateCredentialContext(context), context);
  for (const value of [null, { ...context, runId: 'not a UUID' }, { ...context, nodeId: '' },
    { ...context, nodeId: 'n'.repeat(4097) }, { ...context, nodeId: 4 }, { ...context, extra: true },
    { binding: valid, nodeId: 'missing run' }, { ...context, binding: { ...valid, secret: 'forbidden' } }]) {
    assert.throws(() => validateCredentialContext(value), code('INVALID'));
  }
});

Then('shared workflow execution routes supported credentials and rejects missing malformed or stale selections', async () => {
  register();
  const secured = operation('secured'), approved = await approvedOperation(secured, origin), selection = binding(approved.fingerprint);
  const calls = [];
  const executor = createWorkflowExecution(async (descriptor, values, context, signal) => {
    calls.push({ descriptor, values, context, signal }); return result(descriptor.operation, values);
  });
  const context = invocation(selection), signal = new AbortController().signal;
  const values = { 'query:label': 'original' }, pending = executor.execute(secured, values, signal, context);
  context.binding.credentials.bearer = crypto.randomUUID(); values['query:label'] = 'changed after submission';
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].descriptor.fingerprint, approved.fingerprint);
  assert.equal(calls[0].context.runId, context.runId);
  assert.notEqual(calls[0].context.binding.credentials.bearer, context.binding.credentials.bearer);
  assert.equal(calls[0].values['query:label'], 'original'); assert.equal(calls[0].signal, signal);
  await assert.rejects(executor.execute(secured, {}), code('PERMISSION'));
  await assert.rejects(executor.execute(secured, {}, undefined, invocation(binding('0'.repeat(64)))), code('PERMISSION'));
  await assert.rejects(executor.execute(secured, {}, undefined, invocation({ ...selection, alternative: 31 })), code('PERMISSION'));
  await assert.rejects(executor.execute(secured, {}, undefined, invocation({ ...selection, credentials: {} })), code('PERMISSION'));
  await assert.rejects(executor.execute(secured, {}, undefined, invocation({ ...selection, credentials: { other: crypto.randomUUID() } })), code('PERMISSION'));
  for (const invalid of [{ ...context, binding: { ...selection, alternative: 0.5 } },
    { ...context, binding: { ...selection, credentials: { bearer: 'invalid' } } }, { ...context, nodeId: null }]) {
    await assert.rejects(executor.execute(secured, {}, undefined, invalid), code('INVALID'));
  }
  for (const patch of [{ id: 'missing' }, { method: 'POST' }, { path: '/changed' }]) {
    await assert.rejects(executor.execute({ ...secured, ...patch }, {}, undefined, context), /registered schemas/);
  }
  const next = schema(); next.servers = [{ url: 'https://changed.example/v2' }]; register(next);
  await assert.rejects(executor.execute(secured, {}, undefined, invocation(selection)), code('PERMISSION'));
  const unsupported = schema(); unsupported.components.securitySchemes.bearer = { type: 'http', scheme: 'basic' };
  assert.throws(() => register(unsupported), /bearer/);
  assert.equal(calls.length, 1);
  const originalDigest = crypto.subtle.digest;
  for (const change of [document => { document.servers = [{ url: 'https://raced.example' }]; },
    document => { document.paths['/secured'].get.parameters[0].schema.type = 'integer'; }]) {
    register();
    crypto.subtle.digest = async function (...args) {
      const digest = await originalDigest.apply(this, args);
      const changed = schema(); change(changed); register(changed);
      return digest;
    };
    try {
      await assert.rejects(executor.execute(operation('secured'), {}, undefined, invocation(selection)), code('PERMISSION'));
    } finally { crypto.subtle.digest = originalDigest; }
  }
  assert.equal(calls.length, 1);
});

Then('anonymous execution rejects authenticated alternatives and only permits an explicitly selected anonymous alternative', async () => {
  register(); const requests = [];
  const executor = createWorkflowRequestExecution(async (url, options) => { requests.push({ url, options }); return Response.json({ result: 'public' }); });
  const secured = operation('secured'), optional = operation('optional');
  const approved = await approvedOperation(secured, origin), optionalApproved = await approvedOperation(optional, origin);
  await assert.rejects(executor.execute(secured, {}), code('PERMISSION'));
  await assert.rejects(executor.execute({ ...secured, security: [] }, {}), code('PERMISSION'));
  await assert.rejects(executor.execute(secured, {}, undefined, invocation(binding(approved.fingerprint))), code('PERMISSION'));
  await assert.rejects(executor.execute(optional, {}), code('PERMISSION'));
  const anonymous = { alternative: 1, credentials: {}, fingerprint: optionalApproved.fingerprint };
  for (const selection of [{ ...anonymous, fingerprint: '0'.repeat(64) }, { ...anonymous, alternative: 31 },
    { ...anonymous, credentials: { bearer: crypto.randomUUID() } }]) {
    await assert.rejects(executor.execute(optional, {}, undefined, invocation(selection)), code('PERMISSION'));
  }
  await assert.rejects(executor.execute(optional, {}, undefined, invocation({ ...anonymous, alternative: 1.5 })), code('INVALID'));
  assert.equal(requests.length, 0);
  await executor.execute(optional, {}, undefined, invocation(anonymous));
  assert.equal(requests[0].url, `${origin}/optional`);
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ result: 'public' }); };
  const shared = createWorkflowExecution(async () => { throw new Error('anonymous option must not reach vault'); });
  await shared.execute(optional, {}, undefined, invocation(anonymous));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.options.credentials === 'omit' && request.options.redirect === 'error'));
  const originalDigest = crypto.subtle.digest;
  crypto.subtle.digest = async function (...args) {
    const digest = await originalDigest.apply(this, args);
    const changed = schema(); changed.servers = [{ url: 'https://raced.example' }]; register(changed);
    return digest;
  };
  try {
    await assert.rejects(executor.execute(optional, {}, undefined, invocation(anonymous)), code('PERMISSION'));
  } finally { crypto.subtle.digest = originalDigest; }
  assert.equal(requests.length, 2);
});

Then('public workflow operations use the default anonymous executor without touching the vault', async () => {
  register(); let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ public: true }); };
  const execution = createWorkflowExecution();
  assert.deepEqual((await execution.execute(operation('public'), {})).response.body, { public: true });
  const runner = createWorkflowRunner(workflow([operationNode('public-node', undefined, 'public')]));
  runner.next(); await runner.submit({});
  assert.equal(count, 2);
  assert.equal(runner.next().kind, 'complete');
});

Then('two workflow nodes invoking the same operation receive separate credential bindings and invocation identities', async () => {
  register(); const secured = operation('secured'), approved = await approvedOperation(secured, origin);
  const first = binding(approved.fingerprint), second = binding(approved.fingerprint), replacement = binding(approved.fingerprint);
  const document = workflow([operationNode('first', first), operationNode('second', second)], [{ id: 'next', source: 'first', target: 'second' }]);
  const calls = [];
  const executor = createWorkflowExecution(async (descriptor, values, context) => { calls.push(context); return result(descriptor.operation, values); });
  const runner = createWorkflowRunner(document, undefined, executor);
  assert.deepEqual(runner.next().bindingPath, ['first']);
  assert.deepEqual(runner.next().credentialBinding, first);
  await runner.submit({});
  assert.deepEqual(runner.next().bindingPath, ['second']);
  assert.deepEqual(runner.next().credentialBinding, second);
  await runner.submit({}, replacement);
  assert.equal(runner.next().kind, 'complete');
  assert.deepEqual(calls.map(call => call.binding), [first, replacement]);
  assert.equal(calls[0].runId, calls[1].runId);
  assert.notEqual(calls[0].nodeId, calls[1].nodeId);
  assert.deepEqual(document.nodes[1].data.credentialBinding, second);
  const another = createWorkflowRunner(document, 'first', executor); another.next(); await another.submit({});
  assert.notEqual(calls[0].runId, calls[2].runId);
});

Then('repeated nested workflow invocations keep separate node paths and credential selections', async () => {
  register(); const approved = await approvedOperation(operation('secured'), origin), first = binding(approved.fingerprint), second = binding(approved.fingerprint);
  const inner = workflow([operationNode('same-inner-node', first), operationNode('next-inner-node', second)],
    [{ id: 'inner-next', source: 'same-inner-node', target: 'next-inner-node' }], 'inner');
  const middle = workflow([nested('middle-call', inner)], [], 'middle');
  const outer = workflow([nested('outer-call', middle)], [], 'outer');
  const calls = [];
  const executor = createWorkflowExecution(async (descriptor, values, context) => { calls.push(context); return result(descriptor.operation, values); });
  const runner = createWorkflowRunner(outer, undefined, executor);
  assert.deepEqual(runner.next().bindingPath, ['outer-call', 'middle-call', 'same-inner-node']);
  await runner.submit({});
  assert.deepEqual(runner.next().bindingPath, ['outer-call', 'middle-call', 'next-inner-node']);
  await runner.submit({});
  assert.equal(runner.next().kind, 'complete');
  assert.deepEqual(calls.map(call => call.binding), [first, second]);
  assert.equal(calls[0].runId, calls[1].runId); assert.notEqual(calls[0].nodeId, calls[1].nodeId);
  const graph = createOperationGraph(operation('secured'), { x: 0, y: 0 }, 'same-inner-node', schema());
  graph.nodes.find(node => node.id === 'same-inner-node').data.credentialBinding = first;
  const reusable = workflow(graph.nodes, graph.edges, 'reusable');
  const left = createWorkflowGraph(reusable, { x: 0, y: 0 }, 'first-call');
  const secondCopy = structuredClone(reusable);
  secondCopy.nodes.find(node => node.id === 'same-inner-node').data.credentialBinding = second;
  const right = createWorkflowGraph(secondCopy, { x: 400, y: 0 }, 'second-call');
  const repeated = workflow([...left.nodes, ...right.nodes], [...left.edges, ...right.edges]);
  const output = repeated.nodes.find(node => node.type === 'data' && node.data.ownerId === 'first-call'
    && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === 'result'));
  const input = repeated.nodes.find(node => node.type === 'data' && node.data.ownerId === 'second-call'
    && node.data.direction === 'inputs' && node.data.fields.some(field => field.label === 'label'));
  repeated.edges.push({ id: 'repeat-next', kind: 'mapping', source: output.id,
    sourceHandle: output.data.fields.find(field => field.label === 'result').id, target: input.id,
    targetHandle: input.data.fields.find(field => field.label === 'label').id });
  const repeatedRunner = createWorkflowRunner(repeated, undefined, executor);
  assert.deepEqual(repeatedRunner.next().bindingPath, ['first-call', 'same-inner-node']);
  await repeatedRunner.submit({});
  assert.deepEqual(repeatedRunner.next().bindingPath, ['second-call', 'same-inner-node']);
  await repeatedRunner.submit(repeatedRunner.next().values);
  assert.equal(repeatedRunner.next().kind, 'complete');
  assert.deepEqual(calls.slice(2).map(call => call.binding), [first, second]);
  assert.notEqual(calls[2].nodeId, calls[3].nodeId);
});

Then('an explicitly cleared workflow credential blocks dispatch while an omitted selection retains the saved default', async () => {
  register();
  const approved = await approvedOperation(operation('secured'), origin), saved = binding(approved.fingerprint), calls = [];
  const document = workflow([operationNode('saved-selection', saved)]);
  const executor = createWorkflowExecution(async (descriptor, values, context) => {
    calls.push(context.binding); return result(descriptor.operation, values);
  });
  const runner = createWorkflowRunner(document, undefined, executor);
  assert.deepEqual(runner.next().credentialBinding, saved);
  await assert.rejects(runner.submit({}, null), code('PERMISSION'));
  assert.equal(calls.length, 0, 'clearing an incomplete or unapproved choice cannot dispatch with the old saved binding');
  assert.equal(runner.next().nodeId, 'saved-selection');
  await runner.submit({});
  assert.deepEqual(calls, [saved], 'callers omitting the optional argument retain the saved-binding API behavior');
  assert.equal(runner.next().kind, 'complete');
});

Then('portable workflow documents remove credential references at every nesting level without changing local documents', async () => {
  register(); const approved = await approvedOperation(operation('secured'), origin), selection = binding(approved.fingerprint);
  const legacy = workflow([{ ...operationNode('legacy', selection), type: undefined }], [], 'legacy'); legacy.version = 1;
  const inner = workflow([operationNode('inner-operation', selection)], [], 'inner');
  const document = workflow([operationNode('local', selection), nested('child', workflow([nested('grandchild', inner)], [], 'middle')),
    { id: 'comment', type: 'comment', position: { x: 0, y: 0 }, data: { text: 'Unchanged note' } }]);
  const before = structuredClone(document);
  assert.equal(validateWorkflowDocument(document).nodes[0].data.credentialBinding.credentials.bearer, selection.credentials.bearer);
  for (const portable of [portableWorkflowDocument(document), parseWorkflowDocument(JSON.stringify(document)), portableWorkflowDocument(legacy)]) {
    assert.ok(!JSON.stringify(portable).includes('credentialBinding'));
    assert.ok(!JSON.stringify(portable).includes(selection.credentials.bearer));
  }
  assert.deepEqual(document, before);
  const imported = parseWorkflowDocument(JSON.stringify(document));
  let calls = 0;
  const executor = createWorkflowExecution(async (descriptor, values) => { calls++; return result(descriptor.operation, values); });
  const local = createWorkflowRunner(document, 'local', executor); local.next(); await local.submit({});
  assert.equal(calls, 1);
  const runner = createWorkflowRunner(imported, 'local', executor);
  assert.equal(runner.next().credentialBinding, undefined);
  await assert.rejects(runner.submit({}), code('PERMISSION'));
  assert.equal(calls, 1);
});

Then('a redacted authenticated response is preserved while downstream routing and accidental resubmission stop', async () => {
  register(); const approved = await approvedOperation(operation('secured'), origin), selection = binding(approved.fingerprint);
  const document = workflow([operationNode('upstream', selection), operationNode('downstream', selection)], [{ id: 'next', source: 'upstream', target: 'downstream' }]);
  let sent = 0;
  const execution = createWorkflowExecution(async (descriptor, values) => { sent++; return result(descriptor.operation, values,
    { redacted: true, body: { result: '[REDACTED]' } }); });
  const runner = createWorkflowRunner(document, undefined, execution);
  runner.next();
  const completed = await runner.submit({});
  assert.equal(completed.response.redacted, true); assert.equal(completed.response.body.result, '[REDACTED]');
  assert.throws(() => runner.next(), /Sensitive response data was removed/);
  await assert.rejects(runner.submit({}), /no operation ready/);
  assert.equal(sent, 1);
  runner.end(); assert.equal(runner.next().kind, 'complete');
});
