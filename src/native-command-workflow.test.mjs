// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeCommandFixture } from '../tests/native-command.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { updateCatalogs, publishPreparedCatalogs, installOperationModel } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { createSchemaDiscovery } from './lib/schema-index.ts';
import { createOperationGraph, isWorkflowConnection, getAdditionalPropertyTypes } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { approvedNativeOperation } from './lib/secrets/native-rpc-policy.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeCommandMethods } from './lib/native-command.ts';
import { VaultError } from './lib/secrets/types.ts';

Before({ tags: '@native-command-workflow' }, function () { this.commandCatalogs = catalogs; this.commandWorkflows = []; });
After({ tags: '@native-command-workflow' }, async function () {
  for (const c of this.commandWorkflows.reverse()) { c.runner?.end(); c.v.session.lock(); await c.f.close(); }
  updateCatalogs(this.commandCatalogs);
});
const fieldAt = (nodes, owner, group, path) => {
  for (const panel of nodes.filter(node => node.type === 'data' && node.data.ownerId === owner)) {
    const field = panel.data.fields.find(field => { const id = JSON.parse(decodeURIComponent(field.id)); return id[0] === group && id[1] === path; });
    if (field) return { panel, field };
  }
  assert.fail('Missing native command port: ' + owner + ' ' + group + ' ' + path);
};
async function setup(world, options = {}) {
  const f = await nativeCommandFixture({ autoTerminate: true, echoCommandInput: true, ...options }), v = await nativeVaultFixture(f), source = await readServiceSchema('codex');
  const c = { f, v }; world.commandWorkflows.push(c);
  const selections = [...nativeCommandMethods, 'fs/getMetadata'].map(method => { const document = scopeNativeRpcSchema(source, method); return { document, operation: nativeRpcOperation(document, 'codex:' + method) }; });
  const sourceIdentity = 'native-command-' + crypto.randomUUID(), inspection = inspectServiceSchema(source, 'codex'), index = createSchemaDiscovery(inspection, sourceIdentity);
  publishPreparedCatalogs([{ catalog: { id: 'codex', file: 'codex.json', name: inspection.name, document: index.document, groups: index.groups, execution: { kind: 'json-rpc' } }, operations: index.operations, sourceIdentity }]);
  for (const { operation, document } of selections) installOperationModel({ protocol: 'json-rpc', operation, document, sourceIdentity, bytes: Buffer.byteLength(JSON.stringify([operation, document])) });
  const paired = await v.session.pairNativeRuntime(v.input, v.selection), runtime = nativeReference(paired);
  const bindings = Object.fromEntries(await Promise.all(selections.map(async selected => [selected.operation.rpc.method, { runtime, fingerprint: (await approvedNativeOperation(selected.operation, selected.document)).fingerprint }])));
  const ids = options.buffered ? ['exec', 'consumer'] : ['exec', 'resize', 'write', 'terminate'];
  const methods = options.buffered ? ['command/exec', 'fs/getMetadata'] : ['command/exec', 'command/exec/resize', 'command/exec/write', 'command/exec/terminate'];
  const graphs = methods.map((method, i) => { const selected = selections.find(s => s.operation.rpc.method === method); return createOperationGraph(selected.operation, { x: i * 600, y: 0 }, ids[i], selected.document); });
  const graph = { version: 3, id: 'native-command-workflow', name: 'Native command workflow', nodes: graphs.flatMap(g => g.nodes), edges: graphs.flatMap(g => g.edges), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const mapping = (owner, group, path, target, targetPath) => {
    const from = fieldAt(graph.nodes, owner, group, path), to = fieldAt(graph.nodes, target, 'input:params', targetPath);
    const edge = { id: 'mapped-' + graph.edges.length, kind: 'mapping', source: from.panel.id, sourceHandle: from.field.id, target: to.panel.id, targetHandle: to.field.id };
    assert.ok(isWorkflowConnection(edge, graph.nodes, graph.edges)); graph.edges.push(edge);
  };
  if (options.buffered) mapping('exec', 'rpc:result', '/result/stdout', 'consumer', '/path');
  else {
    for (const id of ids.slice(1)) mapping('exec', 'rpc:dispatched', '/dispatched/processId', id, '/processId');
  }
  const notices = [];
  const executor = { execute() { assert.fail('Native commands cannot use HTTP.'); }, async executeNative(operation, values, _binding, signal, progress, onValue) {
    const request = prepareNativeRequest(operation, values);
    if (request.method === 'command/exec') return v.session.executeNativeCommand(runtime, v.selection, selections.slice(0, 4), request.params, signal, progress, onValue);
    assert.ok(nativeCommandMethods.includes(request.method));
    return v.session.controlNativeCommand(runtime, v.selection, selections.slice(0, 4), request.method, request.params, signal);
  } };
  Object.assign(c, { graph, selections, bindings, paired, runtime, notices, executor, runner: createWorkflowRunner(graph, 'exec', executor) }); return c;
}
async function start(c, values) {
  assert.equal(c.runner.next().operation.id, 'codex:command/exec');
  const pending = c.runner.submit(values, undefined, undefined, c.bindings['command/exec'], p => c.notices.push(p));
  void pending.catch(() => {}); await waitForWatch(() => c.notices.length === 1);
  assert.equal(c.f.frames.filter(frame => frame.method === 'command/exec').length, 0);
  await c.v.session.replyNativeCommand(c.paired.id, c.notices[0].token, 'accept'); assert.equal((await pending).kind, 'stream');
}
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);
Then('native command models round trip their typed lifecycle ports and field diagnostics', async function () {
  const c = await setup(this);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(c.graph))), c.graph);
  const code = fieldAt(c.graph.nodes, 'exec', 'rpc:result', '/result/exitCode'); assert.equal(code.field.type, 'Integer');
  assert.equal(fieldAt(c.graph.nodes, 'exec', 'rpc:notification', '/notification/params/deltaBase64').field.type, 'Text');
  for (const [field, value] of [['command', '[]'], ['outputBytesCap', '16385'], ['env', '{"PATH":null}']]) {
    assert.throws(() => prepareNativeRequest(c.selections[0].operation, { 'params:command': '["owned"]', ['params:' + field]: value }), error => error.fieldKey.startsWith('params:' + field));
  }
  const write = c.selections.find(s => s.operation.rpc.method === 'command/exec/write');
  assert.throws(() => prepareNativeRequest(write.operation, { 'params:processId': 'owned', 'params:deltaBase64': '%%%' }), error => error.fieldKey === 'params:deltaBase64');
  for (const selection of c.selections.slice(1, 4)) assert.equal(selection.operation.rpc.workflowDispatched, undefined);
});
async function controls(world, real) {
  const c = await setup(world, { real });
  await start(c, { 'params:command': JSON.stringify(real ? ['/bin/cat'] : ['owned']), 'params:processId': 'workflow-owned', 'params:tty': 'true' });
  assert.equal(c.runner.streams[0].nativeValue.stage, 'dispatched'); assert.equal('result' in c.runner.streams[0].nativeValue, false);
  for (const method of ['command/exec/resize', 'command/exec/write', 'command/exec/terminate']) {
    const next = c.runner.next(); assert.equal(next.operation.rpc.method, method); assert.equal(next.values['params:processId'], 'workflow-owned');
    const values = { ...next.values, ...(method.endsWith('/resize') ? { 'params:size': '{"rows":40,"cols":120}' } : method.endsWith('/write') ? { 'params:deltaBase64': Buffer.from('workflow input\n').toString('base64') } : {}) };
    const result = await c.runner.submit(values, undefined, undefined, c.bindings[method]); assert.deepEqual(result.response.result, {});
    if (method.endsWith('/write')) await waitForWatch(() => c.runner.streams[0].nativeUpdates > 0);
  }
  await waitForWatch(() => c.runner.streams[0].state === 'complete');
  assert.ok(Number.isInteger(c.runner.streams[0].result.response.result.exitCode)); assert.equal((await c.runner.nextAsync()).kind, 'complete'); await ended(c);
}
Then('command workflow controls use the dispatched owned process while terminal results wait', async function () { await controls(this, false); });
Then('the pinned SDK drives command resize stdin termination and terminal workflow results', { timeout: 30000 }, async function () { await controls(this, true); });
async function terminal(world, stop, real = false) {
  const c = await setup(world, { buffered: true, real });
  const command = real ? [process.execPath, '-e', 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("."));'] : ['owned'];
  await start(c, { 'params:command': JSON.stringify(command), 'params:processId': 'buffered', 'params:streamStdin': 'true' });
  let arrived = false; const waiting = c.runner.nextAsync().then(next => { arrived = true; return next; });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(arrived, false);
  if (stop) c.runner.stopStream(c.runner.streams[0].id);
  else if (real) await c.v.session.controlNativeCommand(c.runtime, c.v.selection, c.selections.slice(0, 4), 'command/exec/write', { processId: 'buffered', closeStdin: true });
  else c.f.finishCommand('buffered', { exitCode: 17, stdout: '.', stderr: '' });
  const next = await waiting;
  if (stop) { assert.equal(next.kind, 'complete'); assert.equal(c.runner.streams[0].result, undefined); }
  else { assert.equal(next.operation.rpc.method, 'fs/getMetadata'); assert.equal(next.values['params:path'], '.'); await waitForWatch(() => c.runner.streams[0].state === 'complete'); }
  await ended(c);
}
Then('command terminal workflow mappings wait for completion and wake their downstream form', async function () { await terminal(this, false); });
Then('command workflow stop releases pending terminal mappings without fabricating a result', async function () { await terminal(this, true); });
Then('the pinned SDK releases buffered terminal workflow consumers only after real completion', { timeout: 30000 }, async function () { await terminal(this, false, true); });
Then('command workflows reject foreign out of order duplicate and incomplete lifecycle samples', async function () {
  for (const mode of ['foreign', 'early-output', 'duplicate', 'incomplete']) {
    const c = await setup(this); c.runner.end();
    c.runner = createWorkflowRunner(c.graph, 'exec', { ...c.executor, async executeNative(_op, _values, _binding, signal, _progress, onValue) {
      const dispatched = { protocol: 'json-rpc', stage: 'dispatched', processId: 'owned' };
      if (mode === 'foreign') onValue({ ...dispatched, processId: 'foreign' });
      else if (mode === 'early-output') onValue({ protocol: 'json-rpc', stage: 'completed', processId: 'owned', result: { exitCode: 0, stdout: '', stderr: '' } });
      else { onValue(dispatched); if (mode === 'duplicate') onValue(dispatched); }
      if (signal.aborted) throw new VaultError('CANCELLED');
      return { request: { protocol: 'json-rpc', method: 'command/exec', params: { command: ['owned'] } }, response: { protocol: 'json-rpc', result: { exitCode: 0, stdout: '', stderr: '' } } };
    } });
    c.runner.next(); const result = c.runner.submit({ 'params:command': '["owned"]', 'params:processId': 'owned' }, undefined, undefined, c.bindings['command/exec']);
    if (mode === 'duplicate' || mode === 'incomplete') { await result; await waitForWatch(() => c.runner.streams[0].state === 'error'); }
    else await assert.rejects(result, error => error.code === 'NATIVE_CONTRACT');
    assert.equal(c.runner.streams[0].state, 'error');
  }
});

Then('command workflow completion supports anonymous processes and rejects further terminal callbacks', async function () {
  for (const mode of ['without-id', 'after-completion']) {
    const c = await setup(this); c.runner.end();
    const processId = mode === 'without-id' ? null : 'owned', terminal = { exitCode: 0, stdout: '', stderr: '' };
    c.runner = createWorkflowRunner(c.graph, 'exec', { ...c.executor, async executeNative(_op, _values, _binding, signal, _progress, onValue) {
      onValue({ protocol: 'json-rpc', stage: 'dispatched', processId });
      onValue({ protocol: 'json-rpc', stage: 'completed', processId, result: terminal });
      if (mode === 'after-completion') onValue({ protocol: 'json-rpc', stage: 'completed', processId, result: terminal });
      if (signal.aborted) throw new VaultError('CANCELLED');
      return { request: { protocol: 'json-rpc', method: 'command/exec', params: { command: ['owned'] } }, response: { protocol: 'json-rpc', result: terminal } };
    } });
    c.runner.next();
    const pending = c.runner.submit({ 'params:command': '["owned"]', ...(processId ? { 'params:processId': processId } : {}) }, undefined, undefined, c.bindings['command/exec']);
    assert.equal((await pending).kind, 'stream');
    await waitForWatch(() => c.runner.streams[0].state === (mode === 'without-id' ? 'complete' : 'error'));
    if (mode === 'without-id') assert.deepEqual(c.runner.streams[0].result.response.result, terminal);
    else assert.equal(c.runner.streams[0].result, undefined);
    assert.equal(c.f.frames.filter(frame => frame.method === 'command/exec').length, 0);
  }
});

Then('command dispatch routing errors terminate their stream without making the command retryable', async function () {
  const c = await setup(this); c.runner.end();
  const from = fieldAt(c.graph.nodes, 'exec', 'rpc:dispatched', '/dispatched/processId'), to = fieldAt(c.graph.nodes, 'exec', 'input:params', '/processId');
  c.graph.edges.push({ id: 'dispatch-cycle', kind: 'mapping', source: from.panel.id, sourceHandle: from.field.id, target: to.panel.id, targetHandle: to.field.id });
  c.runner = createWorkflowRunner(c.graph, 'exec', c.executor); c.runner.next();
  const pending = c.runner.submit({ 'params:command': '["owned"]', 'params:processId': 'cycle' }, undefined, undefined, c.bindings['command/exec'], p => c.notices.push(p));
  const rejected = assert.rejects(pending, /loops back to a completed operation/);
  await waitForWatch(() => c.notices.length === 1);
  await c.v.session.replyNativeCommand(c.paired.id, c.notices[0].token, 'accept'); await rejected;
  assert.equal(c.runner.streams[0].state, 'error');
  assert.equal(c.f.frames.filter(frame => frame.method === 'command/exec').length, 1); await ended(c);
});

Then('native notification property editors use only the method declared notification schema', async function () {
  const c = await setup(this);
  const command = c.selections.find(selected => selected.operation.rpc.method === 'command/exec');
  const output = c.graph.nodes.filter(node => node.type === 'data' && node.data.ownerId === 'exec' && node.data.direction === 'outputs');
  const notifications = output.filter(node => JSON.parse(decodeURIComponent(node.id.slice('exec:'.length)))[0] === 'rpc:notification');
  assert.ok(notifications.length > 0);
  for (const panel of notifications) assert.deepEqual(getAdditionalPropertyTypes(c.graph.nodes, panel.id, command.document), []);
  const control = c.selections.find(selected => selected.operation.rpc.method === 'command/exec/resize');
  const root = { ...structuredClone(notifications[0]), id: 'resize:' + encodeURIComponent(JSON.stringify(['rpc:notification', ''])), data: { ...structuredClone(notifications[0].data), ownerId: 'resize' } };
  assert.equal(control.operation.rpc.workflowNotification, undefined);
  assert.deepEqual(getAdditionalPropertyTypes([...c.graph.nodes, root], root.id, control.document), []);
});
