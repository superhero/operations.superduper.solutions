// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { readServiceSchema, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { readServiceSchemaIndex } from './lib/service-schema-indexes.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { scopeNativeRpcSchema, nativeRpcOperation, codexExecutionLimitation } from './lib/native-rpc.ts';
import { approvedNativeOperation, validateApprovedNativeOperation } from './lib/secrets/native-rpc-policy.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { createSchemaDiscovery } from './lib/schema-index.ts';
import { createSchemaModelLoader } from './lib/schema-models.ts';
import { catalogs, catalogForOperation } from './lib/catalog-registry.ts';
import { publishPreparedCatalogs, updateCatalogs, installOperationModel, operationForId, operationOrigin,
  operationSourceIdentity, pinOperationModels } from './lib/catalog.ts';
import { createOperationGraph, getAdditionalPropertyTypes, addAdditionalProperty } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { updateOperationVersion } from './lib/workflow-operation-version.ts';
import { createWorkflowExecution, createWorkflowRequestExecution, workflowExecutionForOperation } from './lib/workflow-execution.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { getOperationReport } from './lib/operation-report.ts';
import { isValueConnection, isWorkflowConnectionTypeCompatible } from './lib/workflow-utilities.ts';

const fixture = (version = '0.163.0', count = 20) => ({ $schema: 'http://json-schema.org/draft-07/schema#',
  info: { title: 'Native fixture', version }, 'x-codex-app-server': { protocol: 'json-rpc', version }, definitions: {
    ClientRequest: { oneOf: Array.from({ length: count }, (_, index) => ({ type: 'object',
      properties: { id: { $ref: '#/definitions/RequestId' }, method: { type: 'string', enum: [`read/${index}`] },
        params: { $ref: '#/definitions/Params' } }, required: ['id', 'method', 'params'] })) },
    RequestId: { type: 'integer' }, Params: { type: 'object', properties: { input: { type: 'string' },
      nested: { $ref: '#/definitions/Nested' } }, required: ['input'] },
    Nested: { type: 'object', properties: { again: { $ref: '#/definitions/Nested' } } },
    Unused: { type: 'string' }, ServerRequest: {}, ClientNotification: {}, ServerNotification: {},
    JSONRPCResponse: { type: 'object', properties: { id: { $ref: '#/definitions/RequestId' }, result: true }, required: ['id', 'result'] },
    JSONRPCError: { type: 'object', properties: { id: { $ref: '#/definitions/RequestId' }, error: {
      type: 'object', properties: { code: { type: 'integer' }, message: { type: 'string' }, data: true }, required: ['code', 'message'] } }, required: ['id', 'error'] },
  } });
const model = (document = fixture(), id = 'native:read/0', identity = 'v1') => {
  const scoped = scopeNativeRpcSchema(document, id.slice(id.indexOf(':') + 1));
  const operation = nativeRpcOperation(scoped, id);
  return { protocol: 'json-rpc', operation, document: scoped, sourceIdentity: identity,
    bytes: Buffer.byteLength(JSON.stringify([operation, scoped])) };
};
function register(document = fixture(), identity = 'v1') {
  const inspected = inspectServiceSchema(document, 'native'), index = createSchemaDiscovery(inspected, identity);
  const entry = { catalog: { id: 'native', name: inspected.name, file: 'native.schema.json',
    document: index.document, groups: index.groups, execution: { kind: 'json-rpc' } }, operations: index.operations, sourceIdentity: identity };
  publishPreparedCatalogs([entry]); return entry;
}
const workflow = graph => ({ version: 3, id: 'native-workflow', name: 'Native workflow', ...graph,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: true });
Before({ tags: '@native-rpc' }, function () { this.nativeCatalogs = catalogs; this.nativeOwners = []; });
After({ tags: '@native-rpc' }, function () {
  for (const owner of this.nativeOwners) pinOperationModels(owner);
  updateCatalogs(this.nativeCatalogs);
});

Then('native RPC hydration preserves pinned methods versions and schema references', async () => {
  const document = await readServiceSchema('codex'), index = await readServiceSchemaIndex('codex');
  const inspected = inspectServiceSchema(document, 'codex');
  assert.equal(serviceSchemaDescriptors.find(item => item.id === 'codex').protocol, 'json-rpc');
  assert.equal(inspected.operations.length, 105);
  assert.deepEqual(inspected.operations.map(value => value.id), index.operations.map(value => value.id));
  for (const method of ['initialize', 'account/login/start', 'thread/start', 'turn/start']) {
    const hydrated = model(document, `codex:${method}`);
    const selected = inspectServiceSchema(document, 'codex', new Set([`codex:${method}`])).operations[0];
    assert.deepEqual(hydrated.operation, selected);
    assert.equal(hydrated.protocol, 'json-rpc'); assert.equal(hydrated.operation.rpc.version, '0.163.0');
    assert.equal(hydrated.operation.rpc.method, method); assert.equal(hydrated.operation.rpc.result, true);
    const handled = ['thread/start', 'thread/resume', 'turn/start'].includes(method);
    assert.equal(hydrated.operation.unavailableReason, handled ? undefined : codexExecutionLimitation);
    assert.equal(hydrated.operation.bodyRequired, false);
    assert.equal(hydrated.operation.fields.length > 0, handled);
    assert.deepEqual(hydrated.operation.rpc.params, document.definitions.ClientRequest.oneOf
      .find(request => request.properties.method.enum[0] === method).properties.params);
    assert.deepEqual(nativeRpcOperation(JSON.parse(JSON.stringify(hydrated.document)), `codex:${method}`), hydrated.operation);
    assert.ok(hydrated.bytes < Buffer.byteLength(JSON.stringify(document)) / 2);
    for (const key of ['origin', 'servers', 'paths', 'openapi']) assert.equal(Object.hasOwn(hydrated.document, key), false);
    assert.equal(Object.hasOwn(hydrated, 'origin'), false);
    assert.equal(hydrated.document.definitions.ClientRequest.oneOf.length, 1);
    assert.equal(hydrated.document.definitions.ServerNotification, undefined);
  }
});

Then('native RPC scoping rejects ambiguous requests and invalid reference closures', () => {
  const original = fixture();
  const scoped = scopeNativeRpcSchema(original, 'read/0');
  assert.equal(scoped.definitions.Unused, undefined);
  assert.deepEqual(scoped.definitions.Nested, original.definitions.Nested);
  assert.deepEqual(original, fixture(), 'Scoping never mutates the source.');
  for (const mutate of [
    value => value.definitions.ClientRequest.oneOf.push(value.definitions.ClientRequest.oneOf[0]),
    value => value.definitions.ClientRequest.oneOf[0].required = ['method'],
    value => value.definitions.Params = { $ref: 'https://outside.test/schema' },
    value => value.definitions.Params = { $ref: '#/definitions/Missing' },
    value => value.definitions.Params = { $ref: '#/definitions/Bad~2Name' },
    value => value.servers = [{ url: 'https://fake.test' }],
    value => value['x-codex-app-server'].version = '0.162.0',
    value => value.definitions.JSONRPCResponse.properties.result = undefined,
    value => value.definitions.Params = { description: 'x'.repeat(1024 * 1024) },
  ]) {
    const source = structuredClone(original); mutate(source);
    assert.throws(() => nativeRpcOperation(source, 'native:read/0'));
  }
  assert.throws(() => scopeNativeRpcSchema(original, 'absent'));
  assert.throws(() => nativeRpcOperation(original, 'read/0'));
});

Then('native model approvals reject altered schemas and HTTP authorization', async () => {
  const original = model(), approved = await approvedNativeOperation(original.operation, original.document);
  assert.equal(Object.hasOwn(approved, 'origin'), false); assert.equal(Object.isFrozen(approved.document.definitions), true);
  assert.deepEqual(await validateApprovedNativeOperation(approved), approved);
  const changed = fixture(); changed.definitions.Params.properties.input.minLength = 2;
  const replacement = model(changed), next = await approvedNativeOperation(replacement.operation, replacement.document);
  assert.notEqual(next.fingerprint, approved.fingerprint);
  const later = model(fixture('0.163.1')), other = model(fixture(), 'native:read/1');
  for (const item of [later, other]) assert.notEqual((await approvedNativeOperation(item.operation, item.document)).fingerprint, approved.fingerprint);
  await assert.rejects(validateApprovedNativeOperation({ ...next, fingerprint: approved.fingerprint }), { code: 'PERMISSION' });
  await assert.rejects(approvedNativeOperation({ ...original.operation, unavailableReason: undefined }, original.document), { code: 'PERMISSION' });
  await assert.rejects(approvedNativeOperation({ ...original.operation, bodyRequired: true }, original.document), { code: 'PERMISSION' });
  await assert.rejects(approvedOperation(original.operation, 'https://fake.test'), { code: 'PERMISSION' });
  let reads = 0;
  const hostile = { ...approved }; Object.defineProperty(hostile, 'document', { enumerable: true, get() { reads++; return original.document; } });
  await assert.rejects(validateApprovedNativeOperation(hostile), { code: 'PERMISSION' });
  await assert.rejects(approvedNativeOperation(original.operation, Object.defineProperty({}, 'info', { enumerable: true, get() { reads++; return {}; } })), { code: 'PERMISSION' });
  assert.equal(reads, 0);
});

Then('native model installation rejects stale sources and retains protocol through republication', function () {
  const entry = register(), original = model();
  installOperationModel(original);
  assert.equal(operationForId(original.operation.id), original.operation); assert.equal(operationOrigin(original.operation.id), undefined);
  publishPreparedCatalogs([{ ...entry, catalog: { ...entry.catalog, name: 'Renamed' } }]);
  assert.equal(catalogForOperation(original.operation.id).execution.kind, 'json-rpc');
  assert.equal(catalogForOperation(original.operation.id).document, original.document);
  assert.equal(getOperationReport(original.operation).catalog.protocol, 'json-rpc');
  const owner = {}; this.nativeOwners.push(owner); pinOperationModels(owner, new Set([original.operation.id]));
  for (let index = 1; index < 5; index++) installOperationModel({ ...model(fixture(), `native:read/${index}`), bytes: 3 * 1024 * 1024 });
  assert.equal(operationForId(original.operation.id), original.operation);
  assert.equal(operationForId('native:read/1'), undefined);
  assert.throws(() => installOperationModel({ ...original, origin: 'https://fake.test' }), /changed/);
  assert.throws(() => installOperationModel({ ...original, protocol: undefined, origin: '' }), /changed/);
  register(fixture('0.163.1'), 'v2'); assert.equal(operationForId(original.operation.id), undefined);
  assert.throws(() => installOperationModel(original), /changed/);
  publishPreparedCatalogs([]); assert.throws(() => installOperationModel(model(fixture('0.163.1'), 'native:read/0', 'v2')), /changed/);
});

Then('native model batches coalesce requests and enforce source identity', async () => {
  register(); const reads = [];
  const loader = createSchemaModelLoader({ existing: operationForId, identity: operationSourceIdentity,
    read: async (schema, identity, ids) => { reads.push(ids); return ids.map(id => model(fixture(), id, identity)); }, install: installOperationModel });
  const ids = Array.from({ length: 20 }, (_, index) => `native:read/${index}`);
  const [first, repeated] = await Promise.all([loader([...ids, ids[0]]), loader(ids.slice(0, 2))]);
  assert.equal(first.length, 20); assert.equal(first[0], repeated[0]); assert.deepEqual(reads.map(ids => ids.length), [16, 4]);
  register(fixture('0.163.1'), 'v2');
  let finish;
  const stale = createSchemaModelLoader({ existing: operationForId, identity: operationSourceIdentity,
    read: () => new Promise(resolve => finish = resolve), install: installOperationModel });
  const pending = stale(['native:read/0']); await Promise.resolve();
  register(fixture('0.163.2'), 'v3'); finish([model(fixture('0.163.1'), 'native:read/0', 'v2')]);
  await assert.rejects(pending, /changed/); assert.equal(operationForId('native:read/0'), undefined);
});

Then('native workflow graphs retain their schema identity without HTTP response fields', () => {
  const current = model(), graph = createOperationGraph(current.operation, { x: 0, y: 0 }, 'owner', current.document);
  const document = workflow(graph), imported = parseWorkflowDocument(JSON.stringify(document));
  assert.deepEqual(imported, document);
  assert.deepEqual(imported.nodes[0].data.rpc, { version: '0.163.0', method: 'read/0' });
  const parameters = graph.nodes.find(node => node.data.label === 'Parameters');
  assert.ok(parameters.data.fields.some(field => field.label === 'input' && field.required && field.type === 'Text'));
  assert.ok(getAdditionalPropertyTypes(graph.nodes, parameters.id, current.document).includes('Text'));
  const extended = addAdditionalProperty(graph.nodes, graph.edges, parameters.id, 'extra', 'Text', current.document);
  assert.ok(parseWorkflowDocument(JSON.stringify(workflow(extended))).nodes.find(node => node.id === parameters.id)
    .data.fields.some(field => field.label === 'extra' && field.type === 'Text'));
  const result = graph.nodes.find(node => node.data.label === 'Result');
  assert.deepEqual(getAdditionalPropertyTypes(graph.nodes, result.id, current.document), [], 'The native wire envelope is closed.');
  assert.deepEqual(result.data.fields.map(field => [field.label, field.type, field.connectable]), [['result', 'Unknown', true]]);
  assert.equal(result.data.fields[0].jsonValue, true);
  const cast = { id: 'cast', type: 'cast', position: { x: 700, y: 0 }, data: { targetType: 'Text' } };
  const mapping = { id: 'native-cast', kind: 'mapping', source: result.id, sourceHandle: result.data.fields[0].id, target: cast.id, targetHandle: 'value' };
  assert.equal(isValueConnection(mapping, result, cast, graph.edges), true);
  assert.equal(isWorkflowConnectionTypeCompatible(mapping, [...graph.nodes, cast], graph.edges), true);
  const connected = workflow({ nodes: [...graph.nodes, cast], edges: [...graph.edges, mapping] });
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(connected)), connected);
  const error = graph.nodes.find(node => node.data.label === 'error');
  assert.ok(error.data.fields.some(field => field.label === 'code' && field.type === 'Integer'));
  const labels = graph.nodes.flatMap(node => node.data.fields ?? []).map(field => field.label);
  assert.ok(!labels.some(label => ['Status', 'Status message', 'Response body', 'Response headers'].includes(label)));
  const portable = portableWorkflowDocument(imported);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(portable)), portable);
  const next = model(fixture('0.163.1'));
  const updated = updateOperationVersion('owner', next.operation, next.document, imported.nodes, imported.edges);
  assert.equal(parseWorkflowDocument(JSON.stringify(workflow(updated))).nodes[0].data.rpc.version, '0.163.1');
});

Then('native workflow imports reject mismatched protocol method and version metadata', () => {
  const current = model(), document = workflow(createOperationGraph(current.operation, { x: 0, y: 0 }, 'owner', current.document));
  for (const mutate of [data => data.protocol = undefined, data => data.rpc = undefined,
    data => data.method = 'GET', data => data.path = '/fake', data => data.rpc.method = 'read/1',
    data => data.rpc.version = 'latest', data => data.protocol = 'http', data => data.operationId = 'other',
    data => data.credentialBinding = {}]) {
    const changed = structuredClone(document); mutate(changed.nodes[0].data);
    assert.throws(() => parseWorkflowDocument(JSON.stringify(changed)));
  }
  for (const flag of [undefined, false, 'true']) {
    const changed = structuredClone(document);
    changed.nodes.find(node => node.data.label === 'Result').data.fields[0].jsonValue = flag;
    assert.throws(() => parseWorkflowDocument(JSON.stringify(changed)));
  }
});

Then('native execution remains guarded after model loading and forged page edits', async () => {
  register(); const current = model(); installOperationModel(current);
  let requests = 0, credentials = 0;
  const executors = [createWorkflowRequestExecution(() => { requests++; assert.fail('Native HTTP fetch'); }),
    createWorkflowExecution(() => { credentials++; assert.fail('Native HTTP credentials'); })];
  for (const executor of executors) await assert.rejects(executor.execute(current.operation, {}), /native workflow execution/);
  assert.throws(() => workflowExecutionForOperation(current.operation), /native workflow execution/);
  assert.throws(() => prepareRequest({ ...current.operation, unavailableReason: undefined }, {}), /paired runtime/);
  assert.equal(requests, 0); assert.equal(credentials, 0);
});
