// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeWatchTransportFixture, waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { updateCatalogs, publishPreparedCatalogs, installOperationModel } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { createSchemaDiscovery } from './lib/schema-index.ts';
import { createOperationGraph, createUtilityNode, isWorkflowConnection } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { approvedNativeOperation } from './lib/secrets/native-rpc-policy.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeFilesystemWatchMethods } from './lib/native-filesystem-watch.ts';
import { VaultError } from './lib/secrets/types.ts';

Before({ tags: '@native-watch-workflow' }, function () { this.watchWorkflowCatalogs = catalogs; this.watchWorkflows = []; });
After({ tags: '@native-watch-workflow' }, async function () {
  for (const c of this.watchWorkflows.reverse()) { c.runner?.end(); c.v.session.lock(); await c.f.close(); }
  updateCatalogs(this.watchWorkflowCatalogs);
});
const identity = field => JSON.parse(decodeURIComponent(field.id));
const fieldAt = (nodes, group, path) => {
  for (const panel of nodes.filter(node => node.type === 'data')) {
    const field = panel.data.fields.find(field => { const id = identity(field); return id[0] === group && id[1] === path; });
    if (field) return { panel, field };
  }
  assert.fail('Missing typed native port: ' + group + ' ' + path);
};
async function setup(world, options = {}) {
  const f = await nativeWatchTransportFixture(options), v = await nativeVaultFixture(f), source = await readServiceSchema('codex');
  const c = { f, v }; world.watchWorkflows.push(c);
  const selections = nativeFilesystemWatchMethods.map(method => { const document = scopeNativeRpcSchema(source, method); return { document, operation: nativeRpcOperation(document, 'codex:' + method) }; });
  const sourceIdentity = 'native-watch-' + crypto.randomUUID(), inspection = inspectServiceSchema(source, 'codex'), index = createSchemaDiscovery(inspection, sourceIdentity);
  publishPreparedCatalogs([{ catalog: { id: 'codex', file: 'codex.json', name: inspection.name, document: index.document, groups: index.groups, execution: { kind: 'json-rpc' } }, operations: index.operations, sourceIdentity }]);
  for (const { operation, document } of selections) installOperationModel({ protocol: 'json-rpc', operation, document, sourceIdentity, bytes: Buffer.byteLength(JSON.stringify([operation, document])) });
  const paired = await v.session.pairNativeRuntime(v.input, v.selection), runtime = nativeReference(paired);
  const bindings = await Promise.all(selections.map(async selected => ({ runtime, fingerprint: (await approvedNativeOperation(selected.operation, selected.document)).fingerprint })));
  const first = createOperationGraph(selections[0].operation, { x: 0, y: 0 }, 'watch', selections[0].document);
  const second = createOperationGraph(selections[1].operation, { x: 600, y: 0 }, 'unwatch', selections[1].document);
  const from = fieldAt(first.nodes, 'rpc:notification', '/notification/params/watchId'), to = fieldAt(second.nodes, 'input:params', '/watchId');
  const graph = { version: 3, id: 'native-watch-workflow', name: 'Native watch workflow', nodes: [...first.nodes, ...second.nodes], edges: [...first.edges, ...second.edges,
    { id: 'owned-watch-id', kind: 'mapping', source: from.panel.id, sourceHandle: from.field.id, target: to.panel.id, targetHandle: to.field.id }], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.ok(isWorkflowConnection(graph.edges.at(-1), graph.nodes, graph.edges.slice(0, -1)));
  if (options.chart) {
    const timestamp = fieldAt(first.nodes, 'rpc:notification', '/notification/emittedAtMs');
    graph.nodes.push(createUtilityNode('chart', { x: 0, y: 600 }, 'chart'));
    graph.edges.push({ id: 'change-times', kind: 'mapping', source: timestamp.panel.id, sourceHandle: timestamp.field.id, target: 'chart', targetHandle: 'value' });
  }
  const executor = { execute() { assert.fail('A native watch cannot use HTTP execution.'); },
    async executeNative(operation, values, _binding, signal, _progress, onValue) {
      const request = prepareNativeRequest(operation, values);
      if (request.method === 'fs/watch') return v.session.executeNativeWatch(runtime, v.selection, selections, request.params, signal, onValue);
      assert.equal(request.method, 'fs/unwatch'); return v.session.executeNativeUnwatch(runtime, v.selection, selections, request.params, signal);
    } };
  Object.assign(c, { graph, selections, bindings, executor, runner: createWorkflowRunner(graph, 'watch', executor) });
  return c;
}
const start = c => { assert.equal(c.runner.next().operation.id, 'codex:fs/watch'); return c.runner.submit({ 'params:watchId': 'workflow-owned', 'params:path': 'watched.txt' }, undefined, undefined, c.bindings[0]); };
const stop = c => { const next = c.runner.next(); assert.equal(next.operation.id, 'codex:fs/unwatch'); return c.runner.submit(next.values, undefined, undefined, c.bindings[1]); };
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);

Then('native watch models round trip typed ports without inventing HTTP responses', async function () {
  const c = await setup(this);
  for (const selection of c.selections) {
    assert.equal(selection.operation.unavailableReason, undefined);
    assert.equal(selection.operation.rpc.result, true);
    const graph = createOperationGraph(selection.operation, { x: 0, y: 0 }, 'owner', selection.document);
    const saved = { ...c.graph, nodes: graph.nodes, edges: graph.edges };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(saved))), saved);
  }
  const port = fieldAt(c.graph.nodes, 'rpc:notification', '/notification/params/changedPaths'); assert.equal(port.field.type, 'Array');
  const timestamp = fieldAt(c.graph.nodes, 'rpc:notification', '/notification/emittedAtMs'); assert.equal(timestamp.field.type, 'Integer');
  for (const invalid of [{ 'params:watchId': '', 'params:path': '.' }, { 'params:watchId': 'x', 'params:path': '.', 'params:recursive': 'true' }]) assert.throws(() => prepareNativeRequest(c.selections[0].operation, invalid));
  assert.equal(c.selections[1].operation.rpc.workflowNotification, undefined);
});
Then('native watch acknowledgements release the form and real events route the owned unwatch ID', async function () {
  const c = await setup(this); assert.equal((await start(c)).kind, 'stream'); assert.equal(c.runner.streams[0].state, 'running');
  assert.deepEqual(c.runner.streams[0].nativeValue, { protocol: 'json-rpc', result: { path: join(c.f.workspace, 'watched.txt') } });
  let delivered = false; const waiting = c.runner.nextAsync().then(value => { delivered = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(delivered, false);
  c.f.emitWatch('workflow-owned'); const next = await waiting;
  assert.equal(next.values['params:watchId'], 'workflow-owned'); assert.ok(next.mappedFields.includes('params:watchId'));
  const result = await stop(c); assert.deepEqual(result.response, { protocol: 'json-rpc', result: {} });
  await waitForWatch(() => c.runner.streams[0].state === 'complete'); assert.equal(c.runner.next().kind, 'complete'); assert.equal(c.runner.done, true);
  assert.equal(c.runner.streams[0].result.response.notification.params.watchId, 'workflow-owned'); await ended(c);
});
Then('native watch samples update live charts without replaying downstream operations', async function () {
  const c = await setup(this, { chart: true }); await start(c); c.f.emitWatch('workflow-owned'); await c.runner.nextAsync();
  await waitForWatch(() => c.runner.streams[0].nativeUpdates === 1);
  c.f.emit({ method: 'fs/changed', params: { watchId: 'workflow-owned', changedPaths: [join(c.f.workspace, 'watched.txt')] }, emittedAtMs: 1235 });
  await waitForWatch(() => c.runner.streams[0].nativeUpdates === 2);
  assert.deepEqual(c.runner.chartResults[0].series[0].points.map(point => point.y), [1234, 1235]);
  assert.equal(c.f.frames.filter(frame => frame.method === 'fs/unwatch').length, 0);
  c.runner.stopStream(c.runner.streams[0].id); await waitForWatch(() => c.runner.streams[0].state === 'stopped'); await ended(c);
  assert.equal(c.runner.next().operation.id, 'codex:fs/unwatch'); await stop(c); assert.equal(c.runner.next().kind, 'complete');
});
Then('native watch stop and run teardown release pending notification consumers', async function () {
  for (const mode of ['stop', 'end']) {
    const c = await setup(this); await start(c); const waiting = c.runner.nextAsync();
    if (mode === 'stop') c.runner.stopStream(c.runner.streams[0].id); else c.runner.end();
    assert.equal((await waiting).kind, 'complete'); await ended(c); assert.equal(c.runner.done, true);
  }
});
Then('native watch root loss routes its last known path before stream termination', async function () {
  const c = await setup(this); await start(c); const waiting = c.runner.nextAsync(), path = join(c.f.workspace, 'watched.txt');
  await rm(path); c.f.emitWatch('workflow-owned', [path]); const next = await waiting;
  assert.equal(next.values['params:watchId'], 'workflow-owned'); await waitForWatch(() => c.runner.streams[0].state === 'error');
  assert.deepEqual(c.runner.streams[0].nativeValue.notification.params.changedPaths, [path]); assert.ok(c.runner.streams[0].error);
  assert.equal(c.runner.next().id, next.id); await stop(c); await ended(c);
});
Then('native watch runners reject unclassified samples before promotion', async function () {
  const c = await setup(this); c.runner.end();
  c.runner = createWorkflowRunner(c.graph, 'watch', { ...c.executor, executeNative(_operation, _values, _binding, signal, _progress, onValue) {
    return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new VaultError('CANCELLED')), { once: true }); onValue({ status: 200, body: 'unclassified' }); });
  } });
  await assert.rejects(start(c), error => error.code === 'NATIVE_CONTRACT'); assert.equal(c.runner.streams[0].state, 'error'); assert.ok(c.runner.streams[0].error); assert.equal(c.runner.streams[0].nativeValue, undefined);
});
Then('the pinned SDK routes a filesystem event through native workflow ports and explicit unwatch', { timeout: 30_000 }, async function () {
  const c = await setup(this, { real: true }); assert.equal((await start(c)).kind, 'stream'); const waiting = c.runner.nextAsync();
  await writeFile(join(c.f.workspace, 'watched.txt'), 'Actual SDK event delivered to workflow output ports.');
  const next = await waiting; assert.equal(next.values['params:watchId'], 'workflow-owned'); await stop(c);
  await waitForWatch(() => c.runner.streams[0].state === 'complete'); assert.ok(Number.isSafeInteger(c.runner.streams[0].nativeValue.notification.emittedAtMs)); await ended(c);
});
