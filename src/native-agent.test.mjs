// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeAgentFixture } from '../tests/native-agent.fixture.mjs';
import { NativeRuntimeBroker } from './lib/secrets/native-runtime.ts';
import { NativeAgentBroker } from './lib/secrets/native-agent.ts';
import { nativeLoginParams, nativeWorkflowParams } from './lib/native-agent-contract.ts';
import { nativeRuntimeProfile } from './lib/native-runtime-contract.ts';
import { VaultError } from './lib/secrets/types.ts';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { nativeRpcOperation, scopeNativeRpcSchema } from './lib/native-rpc.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { installOperationModel, publishPreparedCatalogs, updateCatalogs } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { createSchemaDiscovery } from './lib/schema-index.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { portableWorkflowDocument } from './lib/workflow-document.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';

Before({ tags: '@native-agent' }, function () { this.nativeAgentFixtures = []; this.nativeAgentVaults = []; this.nativeAgentCatalogs = catalogs; });
After({ tags: '@native-agent' }, async function () {
  for (const value of this.nativeAgentVaults) value.session.lock();
  for (const item of this.nativeAgentFixtures.reverse()) { item.transport.clear(); await item.f.close(); }
  updateCatalogs(this.nativeAgentCatalogs);
});
const wait = async predicate => {
  const deadline = Date.now() + 1800;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('Native fixture did not reach the expected transition.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function setup(world, options = {}) {
  const f = await nativeAgentFixture(options), transport = new NativeRuntimeBroker(f.runtime), agent = new NativeAgentBroker(transport);
  const connection = { id: randomUUID(), revision: 1, fingerprint: 'c'.repeat(64), profile: nativeRuntimeProfile, label: 'Native workflow fixture', host: f.publicOrigin,
    pairingKeyId: randomUUID(), keyHash: 'a'.repeat(64), modelFingerprint: 'b'.repeat(64), workflowFingerprint: 'd'.repeat(64),
    identity: { ...f.identity }, accountType: options.account?.type ?? 'none' };
  const value = { f, transport, agent, connection, enabled: true, notices: [], guard: async () => { if (!value.enabled) throw new VaultError('PERMISSION'); } };
  value.progress = notice => value.notices.push(notice);
  value.login = (input, signal) => agent.login(connection, f.key, connection.workflowFingerprint, input, value.guard, signal, value.progress);
  value.execute = (method, params, signal) => agent.execute(connection, f.key, connection.workflowFingerprint, method, params, value.guard, signal, value.progress);
  value.thread = async () => (await value.execute('thread/start', {})).thread.id;
  world.nativeAgentFixtures.push(value); return value;
}

Then('native browser and device logins wait while API key login has no login ID', async function () {
  for (const type of ['chatgpt', 'chatgptDeviceCode', 'apiKey']) {
    const v = await setup(this); let settled = false;
    const run = v.login(type === 'apiKey' ? { type, apiKey: 'synthetic-provider-key-9182' } : { type });
    void run.then(() => { settled = true; });
    if (type !== 'apiKey') {
      await wait(() => v.notices.some(value => value.kind === 'login'));
      assert.equal(settled, false, 'A login acknowledgement is not completion.'); v.f.finishLogin();
    }
    const result = await run;
    assert.equal(result.accountType, type === 'apiKey' ? 'apiKey' : 'chatgpt');
    assert.notEqual(result.identity.accountEpoch, v.connection.identity.accountEpoch);
    assert.equal(v.f.frames.filter(value => value.method === 'account/read').length, 1);
    assert.equal(JSON.stringify(v.notices).includes('synthetic-provider-key-9182'), false);
    assert.equal(v.f.frames.some(value => value.method === 'account/logout'), false);
    v.transport.clear(); await wait(() => v.f.stops === 1);
  }
});

Then('native thread turns require a one off approval and a matching completed result', async function () {
  const v = await setup(this, { account: { type: 'apiKey' } }), threadId = await v.thread(); let settled = false;
  const run = v.execute('turn/start', { threadId, input: [{ type: 'text', text: 'Inspect this workspace.' }] });
  void run.then(() => { settled = true; });
  await wait(() => v.notices.some(value => value.kind === 'approval'));
  assert.equal(settled, false, 'The turn start acknowledgement cannot finish execution.');
  const prompt = v.notices.find(value => value.kind === 'approval').interaction;
  await assert.rejects(v.agent.reply(v.connection.id, randomUUID(), 'accept'), error => error.code === 'PERMISSION');
  await assert.rejects(v.agent.reply(v.connection.id, prompt.token, 'acceptForSession'), error => error.code === 'PERMISSION');
  await v.agent.reply(v.connection.id, prompt.token, 'accept');
  const result = await run; assert.equal(result.threadId, threadId); assert.equal(result.turn.status, 'completed');
  assert.equal(result.turn.items[0].text, 'Synthetic completed result'); assert.deepEqual(v.f.decisions, ['accept']);
  assert.equal('status' in result, false); assert.equal('headers' in result, false);
  await assert.rejects(v.agent.reply(v.connection.id, prompt.token, 'accept'), error => error.code === 'PERMISSION');
  assert.equal((await v.execute('thread/resume', { threadId })).thread.id, threadId);
});

Then('cancelling a native turn interrupts the owned child without logout', async function () {
  const v = await setup(this, { account: { type: 'apiKey' }, manualTurn: true }), threadId = await v.thread(), cancel = new AbortController();
  const run = v.execute('turn/start', { threadId, input: [{ type: 'text', text: 'Wait for cancellation.' }] }, cancel.signal);
  await wait(() => v.notices.some(value => value.kind === 'running')); cancel.abort();
  await assert.rejects(run, error => error.code === 'CANCELLED'); await wait(() => v.f.stops === 1);
  assert.equal(v.f.interrupts, 1); assert.equal(v.f.frames.some(value => value.method === 'account/logout'), false);
  assert.equal(v.f.frames.filter(value => value.method === 'turn/start').length, 1);
});

Then('stale native source cannot approve or complete a turn', async function () {
  const v = await setup(this, { account: { type: 'apiKey' } }), threadId = await v.thread();
  const run = v.execute('turn/start', { threadId, input: [{ type: 'text', text: 'Inspect the source.' }] });
  await wait(() => v.notices.some(value => value.kind === 'approval'));
  const prompt = v.notices.find(value => value.kind === 'approval').interaction; v.enabled = false;
  await assert.rejects(v.agent.reply(v.connection.id, prompt.token, 'accept'), error => error.code === 'PERMISSION');
  v.f.completeTurn(); await assert.rejects(run, error => error.code === 'PERMISSION'); assert.equal(v.f.decisions, undefined);
});

Then('a disconnected native turn fails with an unknown outcome and no replay', async function () {
  const v = await setup(this, { account: { type: 'apiKey' }, manualTurn: true }), threadId = await v.thread();
  const run = v.execute('turn/start', { threadId, input: [{ type: 'text', text: 'Do not replay this.' }] });
  await wait(() => v.notices.some(value => value.kind === 'running')); v.f.exit();
  await assert.rejects(run, error => error.code === 'NATIVE_UNKNOWN'); await wait(() => v.f.stops === 1);
  assert.equal(v.f.starts, 1); assert.equal(v.f.frames.filter(value => value.method === 'turn/start').length, 1);
});

Then('failed and interrupted native turns return explicit failures', async function () {
  for (const status of ['failed', 'interrupted']) {
    const v = await setup(this, { account: { type: 'apiKey' }, manualTurn: true }), threadId = await v.thread();
    const run = v.execute('turn/start', { threadId, input: [{ type: 'text', text: 'Fail explicitly.' }] });
    await wait(() => v.notices.some(value => value.kind === 'running')); v.f.completeTurn(status);
    await assert.rejects(run, error => error.code === (status === 'failed' ? 'NATIVE_FAILED' : 'CANCELLED'));
  }
});

Then('native workflows reject internal login foreign threads and configuration overrides', async function () {
  assert.throws(() => nativeLoginParams({ type: 'chatgptAuthTokens', accessToken: 'private' }));
  for (const override of ['cwd', 'sandbox', 'sandboxPolicy', 'config', 'history', 'path', 'modelProvider'])
    assert.throws(() => nativeWorkflowParams('thread/start', { [override]: '/foreign' }));
  const v = await setup(this, { account: { type: 'apiKey' } }); await v.thread();
  await assert.rejects(v.execute('thread/resume', { threadId: 'foreign_thread' }));
  assert.equal(v.f.frames.filter(value => value.method === 'thread/resume').length, 0);
});

Then('early native login completion is matched and a foreign completion is rejected', async function () {
  const early = await setup(this, { earlyLogin: true }); assert.equal((await early.login({ type: 'chatgptDeviceCode' })).accountType, 'chatgpt');
  const foreign = await setup(this); const run = foreign.login({ type: 'chatgptDeviceCode' });
  await wait(() => foreign.notices.some(value => value.kind === 'login')); foreign.f.finishLogin(true, 'foreign_login');
  await assert.rejects(run); assert.equal(foreign.f.frames.filter(value => value.method === 'account/read').length, 0);
});

Then('native workflow management keeps credentials private and rejects stale runtime selections', async function () {
  const v = await setup(this), vault = await nativeVaultFixture(v.f); this.nativeAgentVaults.push(vault);
  const selections = await vault.workflowSelections(), paired = await vault.session.pairNativeRuntime(vault.input, vault.selection);
  const enabled = await vault.session.enableNativeWorkflow(nativeReference(paired), selections);
  assert.equal(enabled.revision, 2); assert.match(enabled.workflowFingerprint, /^[a-f0-9]{64}$/);
  const notices = [], login = vault.session.loginNativeRuntime(nativeReference(enabled), selections, { type: 'chatgptDeviceCode' }, undefined, value => notices.push(value));
  await wait(() => notices.some(value => value.kind === 'login')); v.f.finishLogin(); let connected = await login;
  assert.equal(connected.accountType, 'chatgpt'); assert.equal(connected.revision, 3);
  const apiKeys = await vault.session.put(null, { label: 'Codex provider key', kind: 'apiKey', value: 'native-vault-provider-key-9182' });
  connected = await vault.session.loginNativeRuntime(nativeReference(connected), selections,
    { type: 'apiKey', credentialId: apiKeys.find(value => value.label === 'Codex provider key').id });
  assert.equal(connected.accountType, 'apiKey'); assert.equal(connected.revision, 4);
  const start = selections.find(value => value.operation.rpc.method === 'thread/start');
  await assert.rejects(vault.session.executeNativeRuntime(nativeReference(enabled), selections, start, {}), error => error.code === 'CONFLICT');
  const malformed = structuredClone(selections); malformed[0].operation.fields.push({ key: 'forged' });
  const before = v.f.frames.length;
  await assert.rejects(vault.session.executeNativeRuntime(nativeReference(connected), malformed, start, {}), error => error.code === 'PERMISSION');
  assert.equal(v.f.frames.length, before);
  const thread = await vault.session.executeNativeRuntime(nativeReference(connected), selections, start, {});
  assert.equal(thread.request.protocol, 'json-rpc'); assert.equal('path' in thread.request, false);
  const turn = selections.find(value => value.operation.rpc.method === 'turn/start');
  const keys = await vault.session.put(null, { label: 'Synthetic private value', kind: 'secret', value: 'vault-native-secret-9182' });
  assert.ok(keys.length); v.f.terminalText = 'vault-native-secret-9182';
  const dispatched = v.f.frames.length;
  await assert.rejects(vault.session.executeNativeRuntime(nativeReference(connected), selections, turn,
    { threadId: thread.response.result.thread.id, input: [{ type: 'text', text: 'vault-native-secret-9182' }] }), error => error.code === 'REDACTED');
  assert.equal(v.f.frames.length, dispatched, 'Registered credentials cannot become ordinary native inputs.');
  const result = vault.session.executeNativeRuntime(nativeReference(connected), selections, turn,
    { threadId: thread.response.result.thread.id, input: [{ type: 'text', text: 'Redact private result.' }] }, undefined, value => notices.push(value));
  await wait(() => notices.some(value => value.kind === 'approval'));
  const prompt = notices.find(value => value.kind === 'approval').interaction;
  await vault.session.replyNativeRuntime(connected.id, prompt.token, 'accept');
  await assert.rejects(result, error => error.code === 'REDACTED');
  assert.equal(JSON.stringify(notices).includes(v.f.key), false);
  assert.equal(JSON.stringify(vault.storage.state).includes(v.f.key), false);
  assert.equal(JSON.stringify(vault.storage.state).includes('vault-native-secret-9182'), false);
  assert.equal(JSON.stringify(vault.storage.state).includes('native-vault-provider-key-9182'), false);
});

Then('a native graph runs through parameters and typed terminal result ports without HTTP', async function () {
  const v = await setup(this, { account: { type: 'apiKey' } }), source = await readServiceSchema('codex');
  const inspected = inspectServiceSchema(source, 'codex'), discovery = createSchemaDiscovery(inspected, 'native-workflow-fixture');
  publishPreparedCatalogs([{ catalog: { id: 'codex', name: inspected.name, file: 'codex.schema.json', document: discovery.document,
    groups: discovery.groups, execution: { kind: 'json-rpc' } }, operations: discovery.operations, sourceIdentity: 'native-workflow-fixture' }]);
  const models = ['thread/start', 'turn/start'].map(method => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    installOperationModel({ protocol: 'json-rpc', operation, document, sourceIdentity: 'native-workflow-fixture', bytes: Buffer.byteLength(JSON.stringify([operation, document])) });
    return { operation, document };
  });
  const graphs = models.map((model, index) => createOperationGraph(model.operation, { x: index * 500, y: 0 }, index ? 'turn' : 'thread', model.document));
  const doc = { version: 3, id: 'native-runner', name: 'Native runner', nodes: graphs.flatMap(value => value.nodes), edges: graphs.flatMap(value => value.edges),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const binding = { runtime: nativeReference(v.connection), fingerprint: 'e'.repeat(64) };
  for (const node of doc.nodes.filter(node => node.type === 'operation')) node.data.nativeBinding = binding;
  const find = (owner, direction, path) => {
    for (const node of doc.nodes.filter(node => node.type === 'data' && node.data.ownerId === owner && node.data.direction === direction))
      for (const field of node.data.fields) if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node, field };
    assert.fail('Missing native graph port ' + path);
  };
  const output = find('thread', 'outputs', '/result/thread/id'), input = find('turn', 'inputs', '/threadId');
  assert.equal(output.field.type, 'Text'); assert.equal(input.field.type, 'Text');
  doc.edges.push({ id: 'thread-id-mapping', kind: 'mapping', source: output.node.id, sourceHandle: output.field.id, target: input.node.id, targetHandle: input.field.id });
  const runner = createWorkflowRunner(doc, 'thread', { execute() { assert.fail('Native graph entered HTTP executor.'); },
    async executeNative(operation, values, selected, signal) {
      assert.deepEqual(selected, binding); const request = prepareNativeRequest(operation, values);
      return { request, response: { protocol: 'json-rpc', result: await v.execute(request.method, request.params, signal) } };
    } });
  assert.equal(runner.next().operation.id, 'codex:thread/start');
  const first = await runner.submit({}); assert.equal(first.response.protocol, 'json-rpc');
  const next = runner.next(); assert.equal(next.operation.id, 'codex:turn/start'); assert.equal(next.values['params:threadId'], first.response.result.thread.id);
  assert.deepEqual(next.mappedFields, ['params:threadId']);
  const run = runner.submit({ ...next.values, 'params:input': JSON.stringify([{ type: 'text', text: 'Run the mapped thread.' }]) });
  await wait(() => v.notices.some(value => value.kind === 'approval'));
  await v.agent.reply(v.connection.id, v.notices.find(value => value.kind === 'approval').interaction.token, 'accept');
  assert.equal((await run).response.result.turn.status, 'completed'); assert.equal(runner.next().kind, 'complete');
  assert.equal(JSON.stringify(portableWorkflowDocument(doc)).includes('nativeBinding'), false);
});

Then('unsupported native permission requests cannot obtain approval', async function () {
  const v = await setup(this, { account: { type: 'apiKey' }, manualTurn: true }), threadId = await v.thread();
  const run = v.execute('turn/start', { threadId, input: [{ type: 'text', text: 'Do not expand permissions.' }] });
  await wait(() => v.notices.some(value => value.kind === 'running'));
  const turnId = v.notices.find(value => value.kind === 'running').turnId;
  v.f.emit({ id: 'file_change', method: 'item/fileChange/requestApproval', params: { threadId, turnId, itemId: 'file_change', startedAtMs: Date.now() } });
  await assert.rejects(run, error => error.code === 'NATIVE_UNKNOWN');
  assert.equal(v.notices.some(value => value.kind === 'approval'), false);
  assert.equal(v.f.decisions, undefined);
});

Then('a cancelled native account confirmation does not publish login success', async function () {
  const v = await setup(this), vault = await nativeVaultFixture(v.f); this.nativeAgentVaults.push(vault);
  const selections = await vault.workflowSelections(), paired = await vault.session.pairNativeRuntime(vault.input, vault.selection);
  const enabled = await vault.session.enableNativeWorkflow(nativeReference(paired), selections), cancel = new AbortController(), notices = [];
  let release, paused = false;
  vault.onSchema = async descriptor => {
    if (!paused && descriptor.operation.rpc.method === 'account/read' && v.f.frames.filter(value => value.method === 'account/read').length >= 2) {
      paused = true; await new Promise(resolve => { release = resolve; });
    }
  };
  const run = vault.session.loginNativeRuntime(nativeReference(enabled), selections, { type: 'chatgptDeviceCode' }, cancel.signal, value => notices.push(value));
  await wait(() => notices.some(value => value.kind === 'login')); v.f.finishLogin(); await wait(() => paused);
  cancel.abort(); release(); await assert.rejects(run, error => error.code === 'CANCELLED');
  const saved = (await vault.session.nativeConnections())[0];
  assert.equal(saved.revision, enabled.revision); assert.equal(saved.accountType, 'none');
  assert.equal(saved.identity.accountEpoch, enabled.identity.accountEpoch);
  assert.equal(v.f.frames.some(value => value.method === 'account/logout'), false);
});
