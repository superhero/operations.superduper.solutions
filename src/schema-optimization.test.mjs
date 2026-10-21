// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { createSchemaCache } from './lib/schema-cache.ts';
import { createSchemaDiscovery, validateSchemaDiscovery } from './lib/schema-index.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { readServiceSchemaIndex, serviceIndexDescriptors } from './lib/service-schema-indexes.ts';
import { catalogs, catalogForOperation } from './lib/catalog-registry.ts';
import { operations, publishPreparedCatalogs, updateCatalogs, operationForId, operationDescriptorForId,
  operationSourceIdentity, operationOrigin, installOperationModel, pinOperationModels } from './lib/catalog.ts';
import { workflowExecutionForOperation, createWorkflowRequestExecution, createWorkflowExecution } from './lib/workflow-execution.ts';
import { workflowOperationIds } from './lib/schema-models.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';
import { prepareRequest } from './lib/operation-input.ts';

const fixture = () => ({ openapi: '3.1.0', info: { title: 'Indexed service', version: '1' },
  servers: [{ url: 'https://api.example.test/v1' }], paths: {
    '/items': { get: { operationId: 'list', summary: 'List items', parameters: [
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } }
    ], responses: { 200: { description: 'OK' } } } },
    '/other': { get: { operationId: 'other', responses: { 200: { description: 'OK' } } } }
  } });

Before({ tags: '@schema-optimization' }, function () { this.previousCatalogs = catalogs; this.modelOwners = []; });
After({ tags: '@schema-optimization' }, function () {
  for (const owner of this.modelOwners) pinOperationModels(owner);
  updateCatalogs(this.previousCatalogs);
});

Then('schema source caching retains recent values within its budget', async () => {
  const cache = createSchemaCache(6);
  const calls = [];
  const read = key => cache.read(key, 3, async () => { calls.push(key); return { key }; });
  const first = await read('a');
  await read('b');
  assert.equal(await read('a'), first);
  await read('c');
  assert.equal(cache.bytes, 6);
  assert.equal(cache.size, 2);
  await read('b');
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
  cache.invalidate('unrelated');
  assert.equal(cache.bytes, 6);
  cache.invalidate('');
  assert.equal(cache.size, 0);
  for (const size of [7, 0, -1, NaN, 1.5]) {
    assert.equal(await cache.read('oversized', size, async () => 'readable without retention'), 'readable without retention');
    assert.equal(cache.size, 0);
  }
});

Then('failed and invalidated schema reads can be retried without stale cache publication', async () => {
  const cache = createSchemaCache(10);
  let complete, loads = 0;
  const load = () => { loads++; return new Promise(resolve => complete = resolve); };
  const first = cache.read('schema:v1', 4, load);
  const second = cache.read('schema:v1', 4, load);
  await Promise.resolve();
  assert.equal(loads, 1);
  complete('shared');
  assert.deepEqual(await Promise.all([first, second]), ['shared', 'shared']);
  cache.invalidate('schema:');
  const obsolete = cache.read('schema:v1', 4, load);
  await Promise.resolve();
  cache.invalidate('schema:');
  assert.equal(await cache.read('schema:v1', 4, async () => 'replacement'), 'replacement');
  complete('obsolete');
  assert.equal(await obsolete, 'obsolete');
  assert.equal(await cache.read('schema:v1', 4, async () => assert.fail('Stale result overwrote the cache')), 'replacement');
  await assert.rejects(cache.read('failed', 4, async () => { throw new Error('Failed source read'); }), /Failed source read/);
  assert.equal(await cache.read('failed', 4, async () => 'retry succeeded'), 'retry succeeded');
});

Then('compact schema indexes preserve every operation without executable models', () => {
  const inspected = inspectServiceSchema(fixture(), 'indexed');
  const discovery = createSchemaDiscovery(inspected, 'revision');
  assert.equal(validateSchemaDiscovery(discovery, 'indexed', 'revision'), discovery);
  assert.deepEqual(discovery.operations.map(operation => operation.id), inspected.operations.map(operation => operation.id));
  assert.ok(discovery.operations.every(operation => operation.deferred && !operation.fields.length && !operation.bodyRequired));
  assert.equal(Object.keys(discovery.document.paths).length, 0);
  assert.equal(discovery.document.info.title, 'Indexed service');
  const unsupported = structuredClone(inspected);
  unsupported.operations[0].unavailableReason = 'Unsupported transport';
  const limited = createSchemaDiscovery(unsupported, 'revision');
  assert.equal(limited.operations[0].unavailableReason, 'Unsupported transport');
  assert.equal(limited.summary.unavailableCount, 1);
});

Then('malformed or stale schema indexes are rejected', () => {
  const original = createSchemaDiscovery(inspectServiceSchema(fixture(), 'indexed'), 'revision');
  for (const mutate of [
    value => value.version = 0, value => value.sourceRevision = 'old', value => delete value.document,
    value => delete value.summary, value => value.summary.name = null, value => value.summary.serverUrl = null,
    value => value.operations = null, value => value.groups = null, value => value.summary.operationCount = 200,
    value => value.operations[0].id = 1, value => value.operations[0].id = 'other:list',
    value => value.operations[1].id = value.operations[0].id,
    value => value.operations[0].name = null, value => value.operations[0].path = null,
    value => value.operations[0].method = null, value => value.operations[0].deferred = false,
    value => value.operations[0].fields.push({ name: 'Unexpected input model' }), value => delete value.operations[0].fields
  ]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => validateSchemaDiscovery(value, 'indexed', 'revision'), /invalid|outdated/);
  }
  assert.throws(() => validateSchemaDiscovery(null, 'indexed', 'revision'), /invalid/);
});

function register(identity = 'v1') {
  const document = fixture();
  const inspected = inspectServiceSchema(document, 'indexed');
  const discovery = createSchemaDiscovery(inspected, identity);
  const catalog = { id: 'indexed', file: 'indexed.json', name: discovery.summary.name,
    document: discovery.document, groups: discovery.groups, execution: { kind: 'http', origin: discovery.summary.serverUrl } };
  const entry = { catalog, operations: discovery.operations, sourceIdentity: identity };
  publishPreparedCatalogs([entry]);
  const model = operation => ({ operation, document: scopeOperationSchema(document, operation.path, operation.method, true).schema,
    origin: discovery.summary.serverUrl, sourceIdentity: identity, bytes: 100 });
  return { document, inspected, entry, model };
}

Then('only a current canonical model can enable a deferred operation', async () => {
  const source = register();
  const descriptor = operations[0];
  assert.equal(operationDescriptorForId(descriptor.id), descriptor);
  assert.equal(operationForId(descriptor.id), undefined);
  assert.equal(operationSourceIdentity(descriptor.id), 'v1');
  assert.equal(operationSourceIdentity('no-colon'), undefined);
  assert.equal(operationOrigin(descriptor.id), undefined);
  assert.throws(() => workflowExecutionForOperation(descriptor), /not available/);
  assert.throws(() => prepareRequest(descriptor, {}), /Load this operation/);
  await assert.rejects(createWorkflowRequestExecution(() => assert.fail('A deferred descriptor executed')).execute(descriptor, {}), /not available/);
  const model = source.model(source.inspected.operations[0]);
  assert.equal(installOperationModel(model), model.operation);
  assert.equal(operationForId(descriptor.id), model.operation);
  assert.equal(operationOrigin(descriptor.id), model.origin);
  assert.equal(catalogForOperation(descriptor.id).document, model.document);
  assert.equal(workflowExecutionForOperation(descriptor).origin, model.origin);
  const requests = [];
  const executor = createWorkflowRequestExecution(async url => { requests.push(url); return new Response(null, { status: 204 }); });
  await executor.execute(model.operation, { 'query:limit': '3' });
  assert.deepEqual(requests, ['https://api.example.test/v1/items?limit=3']);
  await assert.rejects(executor.execute(descriptor, {}), /not available/);
  await assert.rejects(createWorkflowExecution(() => assert.fail('A descriptor reached the credential executor'))
    .execute(descriptor, {}), /not available/);
  const firstOperations = operations;
  publishPreparedCatalogs([source.entry]);
  assert.equal(operations, firstOperations);
  assert.equal(operationForId(descriptor.id), model.operation);
  for (const patch of [
    { sourceIdentity: 'old' }, { operation: { ...model.operation, id: 'missing:operation' } },
    { operation: { ...model.operation, path: '/changed' } }, { operation: { ...model.operation, method: 'POST' } },
    { operation: { ...model.operation, deferred: true } }, { bytes: NaN }, { bytes: -1 }
  ]) assert.throws(() => installOperationModel({ ...model, ...patch }), /schema changed/);
  register('v2');
  assert.equal(operationForId(descriptor.id), undefined);
  assert.throws(() => installOperationModel(model), /schema changed/);
  publishPreparedCatalogs([]);
  assert.equal(operationDescriptorForId(descriptor.id), undefined);
  assert.equal(catalogForOperation(descriptor.id), undefined);
});

Then('workflow model pins retain active data and release obsolete models', function () {
  const source = register();
  const owner = {};
  this.modelOwners.push(owner);
  const [first, second] = source.inspected.operations;
  pinOperationModels(owner, new Set([first.id]));
  installOperationModel({ ...source.model(first), bytes: 8 * 1024 * 1024 });
  installOperationModel({ ...source.model(second), bytes: 8 * 1024 * 1024 });
  assert.equal(operationForId(first.id), first);
  assert.equal(operationForId(second.id), second);
  pinOperationModels(owner);
  assert.equal(operationForId(first.id), undefined);
  assert.equal(operationForId(second.id), second);
  assert.equal(catalogForOperation(first.id), source.entry.catalog);
});

Then('schema hydration collects legacy operations and nested workflow operations', () => {
  const document = { nodes: [
    { data: { operationId: 'legacy:one' } }, { type: 'operation', data: { operationId: 'modern:two' } },
    { type: 'comment', data: {} }, { type: 'vault', data: {} }, { type: 'file', data: {} },
    { type: 'workflow', data: { snapshot: { nodes: [
      { type: 'operation', data: { operationId: 'modern:two' } },
      { type: 'workflow', data: { snapshot: { nodes: [{ type: 'operation', data: { operationId: 'nested:three' } }] } } }
    ] } } }
  ] };
  assert.deepEqual([...workflowOperationIds(document)], ['legacy:one', 'modern:two', 'nested:three']);
  assert.deepEqual([...workflowOperationIds({ nodes: [] })], []);
});

Then('canonical schema slices preserve local references outside the selected operation', () => {
  const document = fixture();
  document.paths['/items'].get.responses[200].links = { next: { operationRef: '#/paths/~1other/get' } };
  const report = scopeOperationSchema(document, '/items', 'GET');
  assert.equal(report.schema.paths['/other'], undefined);
  assert.ok(report.warnings.some(warning => warning.includes('outside this report')));
  const model = scopeOperationSchema(document, '/items', 'GET', true);
  assert.deepEqual(model.schema.paths['/other'].get, document.paths['/other'].get);
  assert.deepEqual(model.warnings, []);
  assert.deepEqual(inspectServiceSchema(model.schema, 'indexed', new Set(['indexed:list'])).operations,
    inspectServiceSchema(document, 'indexed', new Set(['indexed:list'])).operations);
});

Then('every service discovery index matches its source and targeted operation models', { timeout: 120_000 }, async function () {
  let operations = 0, targeted = 0;
  for (const source of serviceSchemaDescriptors) {
    const document = await readServiceSchema(source.id);
    const full = inspectServiceSchema(document, source.id);
    const index = await readServiceSchemaIndex(source.id);
    assert.deepEqual(index, createSchemaDiscovery(full, source.effectiveSha256 ?? source.sha256), source.id);
    for (const operation of full.operations) {
      const model = inspectServiceSchema(document, source.id, new Set([operation.id]), operation).operations[0];
      assert.deepEqual(model, operation, operation.id);
      targeted++;
    }
    assert.deepEqual(inspectServiceSchema(document, source.id, new Set([full.operations[0].id])).operations, [full.operations[0]]);
    operations += full.operations.length;
  }
  assert.equal(targeted, operations);
  await assert.rejects(readServiceSchemaIndex('missing'), /unavailable/);
  await assert.rejects(readServiceSchemaIndex(serviceIndexDescriptors[0].id, { descriptors: serviceIndexDescriptors, packs: {} }), /unavailable/);
  await this.attach(JSON.stringify({ schemas: serviceSchemaDescriptors.length, operations, targeted }), 'application/json');
});
