// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeAgentFixture } from '../tests/native-agent.fixture.mjs';
import { NativeRuntimeBroker } from './lib/secrets/native-runtime.ts';
import { NativeAgentBroker } from './lib/secrets/native-agent.ts';
import { nativeLoginParams, nativeWorkflowParams, nativeRpcId } from './lib/native-agent-contract.ts';
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
import { nativeConfigurationWriteHash } from './lib/native-configuration-write.ts';
import { NativeGuardianReviews, nativeGuardianApprovalMethod, nativeGuardianStarted, nativeGuardianCompleted, nativeGuardianMethod } from './lib/native-guardian.ts';
import { guardianFixtureNotice } from '../tests/native-guardian.fixture.mjs';

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
  await vault.session.disconnectNativeRuntime(nativeReference(paired)); await wait(() => v.f.stops === v.f.starts);
  const sibling = await vault.session.pairNativeRuntime({ ...vault.input, label: 'Sibling native profile' }, vault.selection);
  await vault.session.disconnectNativeRuntime(nativeReference(sibling)); await wait(() => v.f.stops === v.f.starts);
  const siblingBefore = (await vault.session.nativeConnections()).find(connection => connection.id === sibling.id);
  const enabled = await vault.session.enableNativeWorkflow(nativeReference(paired), selections);
  assert.equal(enabled.revision, 2); assert.match(enabled.workflowFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual((await vault.session.nativeConnections()).find(connection => connection.id === sibling.id), siblingBefore);
  const notices = [], login = vault.session.loginNativeRuntime(nativeReference(enabled), selections, { type: 'chatgptDeviceCode' }, undefined, value => notices.push(value));
  await wait(() => notices.some(value => value.kind === 'login')); v.f.finishLogin(); let connected = await login;
  assert.equal(connected.accountType, 'chatgpt'); assert.equal(connected.revision, 3);
  const apiKeys = await vault.session.put(null, { label: 'Codex provider key', kind: 'apiKey', value: 'native-vault-provider-key-9182' });
  connected = await vault.session.loginNativeRuntime(nativeReference(connected), selections,
    { type: 'apiKey', credentialId: apiKeys.find(value => value.label === 'Codex provider key').id });
  assert.equal(connected.accountType, 'apiKey'); assert.equal(connected.revision, 4);
  assert.deepEqual((await vault.session.nativeConnections()).find(connection => connection.id === sibling.id), siblingBefore,
    'Logging into one profile preserves every field of its sibling under the same pairing key.');
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
  await vault.session.put(null, { id: vault.keyId, label: 'Reclassified native pairing key', kind: 'bearer', value: v.f.key });
  assert.equal(await vault.session.copyCredential(vault.keyId), v.f.key);
  assert.deepEqual(await vault.session.nativeConnections(), []);
  await assert.rejects(vault.session.executeNativeRuntime(nativeReference(connected), selections, start, {}), { code: 'CONFLICT' });
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

Then('native text inputs and login credentials reject malformed bounds before dispatch', async () => {
  for (const value of [null, [], 'text']) {
    assert.throws(() => nativeWorkflowParams('thread/start', value)); assert.throws(() => nativeLoginParams(value));
  }
  for (const model of [1, '', ' ', 'x'.repeat(129), 'model\u0000name']) assert.throws(() => nativeWorkflowParams('thread/start', { model }));
  assert.throws(() => nativeWorkflowParams('thread/resume', { threadId: '../foreign' }));
  for (const input of [null, [], Array(17).fill({ type: 'text', text: 'x' }), [{ type: 'image', text: 'x' }],
    [{ type: 'text', text: ' ' }], [{ type: 'text', text: 1 }], [{ type: 'text', text: 'é'.repeat(12289) }]])
    assert.throws(() => nativeWorkflowParams('turn/start', { threadId: 'thread_1', input }));
  for (const apiKey of [1, '', ' ', 'x'.repeat(4097), 'key\nvalue']) assert.throws(() => nativeLoginParams({ type: 'apiKey', apiKey }));
  for (const [id, valid] of [[0, true], [1, true], [-1, false], [1.5, false], [null, false], ['', false]]) assert.equal(nativeRpcId(id), valid);
  const source = await readServiceSchema('codex'), operation = method => nativeRpcOperation(scopeNativeRpcSchema(source, method), 'codex:' + method);
  const turn = operation('turn/start'), thread = operation('thread/start'), valid = { 'params:threadId': 'thread_1', 'params:input': '[{"type":"text","text":"hello"}]' };
  for (const [values, fieldKey] of [[{ ...valid, extra: 'x' }, 'extra'], [{ 'params:threadId': 'thread_1' }, 'params:input'],
    [{ ...valid, 'params:input': '{' }, 'params:input'], [{ ...valid, 'params:input': null }, 'params:input'],
    [{ ...valid, 'params:input': '[{"type":"text","text":" "}]' }, 'params:input']])
    assert.throws(() => prepareNativeRequest(turn, values), error => error.fieldKey === fieldKey);
  assert.throws(() => prepareNativeRequest(thread, { 'params:model': ' ' }), error => error.fieldKey === 'params:model');
  assert.throws(() => prepareNativeRequest({ ...thread, protocol: 'http' }, {}), /Unsupported native/);
  assert.throws(() => prepareNativeRequest({ ...thread, rpc: { ...thread.rpc, version: '0.164.0' } }, {}), /Unsupported native/);
  assert.deepEqual(prepareNativeRequest(thread, {}), { protocol: 'json-rpc', method: 'thread/start', params: {} });
  const params = { threadId: 'thread_1', input: [{ type: 'text', text: 'hello' }] }, cloned = nativeWorkflowParams('turn/start', params);
  cloned.input[0].text = 'changed'; assert.equal(params.input[0].text, 'hello');
});

// Inject the broker's public transport port to deliver hostile private events.
function controlledAgent(options = {}) {
  const v = { notices: [], frames: [], replies: [], closed: 0, identity: { runtimeId: randomUUID(), generation: randomUUID(), accountEpoch: randomUUID(),
    version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64) } };
  v.connection = { id: randomUUID(), host: 'https://native.example.test', identity: v.identity, accountType: 'apiKey' };
  const transport = { async agent(_id, _host, _key, _fingerprint, _identity, _guard, events) {
    v.events = events; const opening = options.connect?.(v); if (opening) await opening; return v.peer;
  }, close() { if (!v.closed++) v.events?.closed(); } };
  v.peer = { identity: v.identity, scope: { connectionId: v.connection.id, method: options.scope ?? 'codex-workflow', fingerprint: 'c'.repeat(64) }, expiresAt: Date.now() + (options.expiresMs ?? 5000),
    async request(method, params, _signal, requestId) { v.frames.push({ method, params });
      v.currentRequest = { method, params, requestId };
      if (options.request) {
        const result = await options.request(method, params, v, requestId);
        if (options.autoApiCompletion !== false && method === 'account/login/start' && params.type === 'apiKey' && result?.type === 'apiKey')
          queueMicrotask(() => v.emit({ method: 'account/login/completed', params: { loginId: null, success: true, error: null } }));
        return result;
      }
      return method === 'turn/start' ? { turn: { id: 'turn_1' } } : { thread: { id: 'thread_1' } };
    }, reply(id, result) { v.replies.push({ id, result }); } };
  v.agent = new NativeAgentBroker(transport, options.scope);
  v.guard = async () => { await options.guard?.(v); };
  v.execute = (method = 'turn/start', signal) => v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), method,
    method === 'turn/start' ? { threadId: 'thread_1', input: [{ type: 'text', text: 'hello' }] } : {}, v.guard, signal, notice => v.notices.push(notice));
  v.login = (input, signal) => v.agent.login(v.connection, 'K'.repeat(43), 'c'.repeat(64), input, v.guard, signal, notice => v.notices.push(notice));
  v.emit = frame => { try { return v.events.frame(frame, v.identity); } catch { transport.close(); return false; } };
  v.close = () => transport.close(); return v;
}

Then('native workflow events reject foreign malformed and excessive approvals without authorizing commands', async () => {
  const approval = { id: 'approval_1', method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', command: 'pwd' } };
  for (const mutate of [
    frame => frame.params.threadId = 'foreign', frame => frame.id = -1, frame => frame.params.turnId = 'foreign',
    frame => frame.params.itemId = '', frame => frame.params.command = '', frame => frame.params.command = 1,
    frame => frame.params.cwd = 1, frame => frame.params.reason = 'x'.repeat(8193),
    ...['grantRoot', 'networkApprovalContext', 'proposedExecpolicyAmendment', 'proposedNetworkPolicyAmendments', 'environmentId'].map(key => frame => frame.params[key] = {}),
    frame => frame.params.kind = 'fileChange', frame => frame.method = 'unsupported/request',
  ]) {
    const v = controlledAgent(), run = v.execute(), failed = assert.rejects(run, { code: 'NATIVE_UNKNOWN' });
    await wait(() => v.notices.some(value => value.kind === 'running'));
    const frame = structuredClone(approval); mutate(frame); assert.equal(v.emit(frame), false); await failed;
    assert.equal(v.notices.some(value => value.kind === 'approval'), false); assert.deepEqual(v.replies, []);
  }
  for (const duplicate of [true, false]) {
    const v = controlledAgent(), run = v.execute(), failed = assert.rejects(run, { code: 'NATIVE_UNKNOWN' });
    await wait(() => v.notices.length);
    for (let index = 0; index < (duplicate ? 1 : 8); index++) assert.equal(v.emit({ ...approval, id: 'approval_' + index }), true);
    assert.equal(v.emit({ ...approval, id: duplicate ? 'approval_0' : 'approval_8' }), false); await failed; assert.deepEqual(v.replies, []);
  }
});

Then('native terminal results and account confirmations cannot claim success with malformed authority', async () => {
  for (const params of [{ threadId: 'thread_1' }, { threadId: 'thread_1', turn: { id: '' } },
    { threadId: 'thread_1', turn: { id: 'foreign', items: [], status: 'completed' } },
    { threadId: 'thread_1', turn: { id: 'turn_1', items: {}, status: 'completed' } },
    { threadId: 'thread_1', turn: { id: 'turn_1', items: [], status: 'inProgress' } }]) {
    const v = controlledAgent(), run = v.execute(), failed = assert.rejects(run, { code: 'NATIVE_UNKNOWN' });
    await wait(() => v.notices.length); v.emit({ method: 'turn/completed', params }); await failed;
  }
  for (const [method, result] of [['turn/start', {}], ['thread/start', { thread: { id: '../foreign' } }]]) {
    const v = controlledAgent({ request: () => result }); await assert.rejects(v.execute(method), { code: 'AUTHORIZATION' }); assert.ok(v.closed);
  }
  const loggedOut = controlledAgent(); loggedOut.connection.accountType = 'none'; await assert.rejects(loggedOut.execute('thread/start'), { code: 'AUTHORIZATION' });
  assert.deepEqual(loggedOut.frames, []);
  const closed = controlledAgent({ connect: v => v.close() }); await assert.rejects(closed.execute('thread/start'), { code: 'NATIVE_UNKNOWN' });
  const failed = controlledAgent({ request() { throw new Error('opaque private detail'); } });
  await assert.rejects(failed.execute('thread/start'), error => error.code === 'NATIVE_UNKNOWN' && !error.message.includes('opaque private'));
});

Then('native login rejects unsafe instructions failed completion and secret echoes', async () => {
  for (const result of [null, { type: 'apiKey' }, { type: 'chatgpt', loginId: '' },
    ...[1, 'x'.repeat(8193), 'http://auth.example.test', 'https://user:secret@auth.example.test'].map(authUrl => ({ type: 'chatgpt', loginId: 'login_1', authUrl })),
    ...[1, '', 'x'.repeat(129)].map(userCode => ({ type: 'chatgptDeviceCode', loginId: 'login_1', userCode, verificationUrl: 'https://auth.example.test' }))]) {
    const type = result?.type === 'chatgptDeviceCode' ? 'chatgptDeviceCode' : 'chatgpt';
    const v = controlledAgent({ request: () => result }); await assert.rejects(v.login({ type }), { code: 'AUTHORIZATION' });
    assert.deepEqual(v.notices, []); assert.ok(v.closed);
  }
  const v = controlledAgent({ request: () => ({ type: 'chatgpt', loginId: 'login_1', authUrl: 'https://auth.example.test' }) });
  const run = v.login({ type: 'chatgpt' }), failed = assert.rejects(run, { code: 'AUTHORIZATION' }); await wait(() => v.notices.length);
  v.emit({ method: 'account/login/completed', params: { loginId: 'login_1', success: false } }); await failed;
  for (const summary of [{ account: null, requiresOpenaiAuth: true }, { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }, { account: { type: 'apiKey' } }]) {
    const owner = controlledAgent({ request: method => method === 'account/login/start' ? { type: 'apiKey' } : summary });
    await assert.rejects(owner.login({ type: 'apiKey', apiKey: 'provider-private-canary' }), { code: 'AUTHORIZATION' });
  }
  let release;
  const secret = controlledAgent({ request: method => method === 'account/login/start' ? new Promise(resolve => { release = resolve; })
    : { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  const login = secret.login({ type: 'apiKey', apiKey: 'provider-private-canary' });
  await wait(() => release); assert.equal(secret.emit({ method: 'account/login/completed', params: { loginId: 'provider-private-canary', success: true } }), false);
  release({ type: 'apiKey' }); await assert.rejects(login, { code: 'NATIVE_UNKNOWN' });
});

Then('native early login events and authority updates retain exact ownership', async () => {
  for (const mode of ['success', 'duplicate', 'foreign', 'malformed', 'authority']) {
    const v = controlledAgent({ request(method, _params, owner) {
      if (method !== 'account/login/start') return { account: { type: 'chatgpt', email: null, planType: 'unknown' }, requiresOpenaiAuth: true };
      const completed = { method: 'account/login/completed', params: { loginId: mode === 'foreign' ? 'foreign' : 'login_1', success: true } };
      if (mode === 'malformed') completed.params.success = 'yes';
      owner.emit(completed);
      if (mode === 'duplicate') owner.emit(completed);
      if (mode === 'authority') owner.emit({ type: 'authority', identity: { ...owner.identity, accountEpoch: randomUUID() } });
      return { type: 'chatgpt', loginId: 'login_1', authUrl: 'https://auth.example.test' };
    } });
    if (mode === 'success') assert.equal((await v.login({ type: 'chatgpt' })).accountType, 'chatgpt');
    else await assert.rejects(v.login({ type: 'chatgpt' }), error => ['AUTHORIZATION', 'NATIVE_UNKNOWN'].includes(error.code));
  }
  const idle = controlledAgent(); await idle.execute('thread/start');
  assert.equal(idle.emit({ method: 'turn/started', params: { threadId: 'thread_1', turn: { id: 'turn_1' } } }), false);
  assert.ok(idle.closed, 'Events after the active operation ends revoke the transport.');
  for (const error of [new Error('private login detail'), new VaultError('NETWORK')]) {
    const unavailable = controlledAgent({ request() { throw error; } });
    await assert.rejects(unavailable.login({ type: 'apiKey', apiKey: 'provider-private-canary' }),
      error => error.code === 'NATIVE_UNKNOWN' && !error.message.includes('private login'));
  }
});

Then('native active requests expire cancel and recheck approval ownership after asynchronous guards', async () => {
  const v = controlledAgent({ expiresMs: 100 }), run = v.execute(), failed = assert.rejects(run, { code: 'NATIVE_UNKNOWN' });
  await wait(() => v.notices.length); await assert.rejects(v.execute('thread/start'), { code: 'CONFLICT' }); await failed; assert.ok(v.closed);
  const cancel = new AbortController(), cancelled = controlledAgent({ connect() { cancel.abort(); } });
  await assert.rejects(cancelled.execute('thread/start', cancel.signal), { code: 'CANCELLED' });
  let closeAtGuard = false;
  const owner = controlledAgent({ guard: v => { if (closeAtGuard) v.close(); } }), turn = owner.execute(), stopped = assert.rejects(turn, { code: 'NATIVE_UNKNOWN' });
  await wait(() => owner.notices.length);
  owner.emit({ id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', command: 'pwd', kind: 'command' } });
  closeAtGuard = true; await assert.rejects(owner.agent.reply(owner.connection.id, owner.notices.find(value => value.kind === 'approval').interaction.token, 'accept'), { code: 'PERMISSION' });
  await stopped; assert.deepEqual(owner.replies, []);
  for (const closed of [true, false]) {
    const controller = new AbortController(), late = controlledAgent({ guard: v => { if (closed) v.close(); else controller.abort(); } });
    await assert.rejects(late.execute('thread/start', controller.signal), { code: closed ? 'NATIVE_UNKNOWN' : 'CANCELLED' });
  }
});

Then('native private workflow management rejects incomplete selections and stale or unenabled authority', async function () {
  const value = await setup(this), v = await nativeVaultFixture(value.f); this.nativeAgentVaults.push(v);
  const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection), reference = nativeReference(paired);
  await assert.rejects(v.session.enableNativeWorkflow(reference, null), { code: 'PERMISSION' });
  await assert.rejects(v.session.enableNativeWorkflow(reference, selections.slice(1)), { code: 'PERMISSION' });
  await assert.rejects(v.session.enableNativeWorkflow(reference, [selections[1], selections[0], ...selections.slice(2)]), { code: 'PERMISSION' });
  await assert.rejects(v.session.loginNativeRuntime(reference, selections, { type: 'chatgpt' }), { code: 'AUTHORIZATION' });
  const enabled = await v.session.enableNativeWorkflow(reference, selections), selected = nativeReference(enabled);
  await assert.rejects(v.session.enableNativeWorkflow(reference, selections), { code: 'CONFLICT' });
  for (const input of [{ type: 'chatgptAuthTokens' }, { type: 'apiKey', credentialId: randomUUID() }, { type: 'apiKey', credentialId: v.keyId }])
    await assert.rejects(v.session.loginNativeRuntime(selected, selections, input), { code: 'PERMISSION' });
  await assert.rejects(v.session.replyNativeRuntime('invalid', randomUUID(), 'accept'), { code: 'INVALID' });
  await assert.rejects(v.session.replyNativeRuntime(enabled.id, 'invalid', 'accept'), { code: 'INVALID' });
  await assert.rejects(v.session.replyNativeRuntime(enabled.id, randomUUID(), 'accept'), { code: 'PERMISSION' });
  await assert.rejects(v.session.executeNativeRuntime(selected, selections, selections[1], {}), { code: 'PERMISSION' });
  const thread = selections.find(selection => selection.operation.rpc.method === 'thread/start');
  await assert.rejects(v.session.executeNativeRuntime(selected, selections, thread, { model: value.f.key }), { code: 'REDACTED' });
  await assert.rejects(v.session.executeNativeRuntime(selected, selections, thread, {}), { code: 'AUTHORIZATION' });
});

Then('overlapping native connects revoke stale ownership and permit a fresh workflow without replay', async function () {
  const v = await setup(this, { account: { type: 'apiKey' } }), Socket = v.f.runtime.WebSocket; let first = true, paired = false;
  v.f.runtime.WebSocket = class extends Socket {
    constructor(url) { super(url); this.holdPair = first; first = false; }
    addEventListener(type, listener, options) {
      return super.addEventListener(type, type === 'message' && this.holdPair ? event => { paired = true; } : listener, options);
    }
  };
  const firstRun = v.execute('thread/start', {}), firstFailure = assert.rejects(firstRun, { code: 'CANCELLED' });
  await wait(() => paired);
  const secondRun = v.execute('thread/start', {}), secondFailure = assert.rejects(secondRun, { code: 'NATIVE_UNKNOWN' });
  await Promise.all([firstFailure, secondFailure]);
  assert.equal(v.f.frames.some(value => value.method === 'thread/start'), false);
  assert.match(await v.thread(), /^thread_/);
  v.transport.clear(); await wait(() => v.f.stops === v.f.starts);
  assert.equal(v.f.frames.filter(value => value.method === 'thread/start').length, 1);
});

Then('native private login redacts progress and cancellation after confirmation cannot update its profile', async function () {
  const value = await setup(this), v = await nativeVaultFixture(value.f); this.nativeAgentVaults.push(v);
  const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  const enabled = await v.session.enableNativeWorkflow(nativeReference(paired), selections), selected = nativeReference(enabled), notices = [];
  const entries = await v.session.put(null, { label: 'Device code canary', kind: 'secret', value: 'ABCD-EFGH' });
  await assert.rejects(v.session.loginNativeRuntime(selected, selections, { type: 'chatgptDeviceCode' }, undefined, notice => notices.push(notice)), { code: 'REDACTED' });
  assert.deepEqual(notices, []);
  await v.session.remove(null, entries.find(entry => entry.label === 'Device code canary').id);
  const cancel = new AbortController(); let confirmedGuards = 0;
  v.onSchema = descriptor => {
    if (descriptor.operation.rpc.method === 'account/read' && value.f.frames.filter(frame => frame.method === 'account/read').length >= 2
      && ++confirmedGuards === 2) cancel.abort();
  };
  value.f.finishLogin = undefined;
  const login = v.session.loginNativeRuntime(selected, selections, { type: 'chatgptDeviceCode' }, cancel.signal);
  const failed = assert.rejects(login, { code: 'CANCELLED' }); await wait(() => value.f.finishLogin); value.f.finishLogin(); await failed;
  assert.equal((await v.session.nativeConnections())[0].revision, enabled.revision);
  await wait(() => value.f.stops === value.f.starts);
  const sibling = await v.session.pairNativeRuntime({ ...v.input, label: 'Sibling runtime' }, v.selection);
  const retained = await v.session.disconnectNativeRuntime(nativeReference(sibling), true);
  assert.deepEqual(retained.map(connection => connection.id), [enabled.id]);
});

Then('native API key login completion retains acknowledgement ownership before and after its reply', async () => {
  for (const mode of ['early', 'null', 'login-id', 'boolean', 'duplicate', 'failed']) {
    const v = controlledAgent({ autoApiCompletion: false, request(method, _params, owner) {
      if (method !== 'account/login/start') return { account: { type: 'apiKey' }, requiresOpenaiAuth: true };
      const frame = { method: 'account/login/completed', params: { loginId: null, success: mode !== 'failed' } };
      if (mode === 'null') frame.params = null;
      if (mode === 'login-id') frame.params.loginId = 'unowned';
      if (mode === 'boolean') frame.params.success = 1;
      owner.emit(frame); if (mode === 'duplicate') owner.emit(frame);
      return { type: 'apiKey' };
    } });
    const work = v.login({ type: 'apiKey', apiKey: 'owned-provider-key' });
    if (mode === 'early') assert.equal((await work).accountType, 'apiKey');
    else await assert.rejects(work, error => ['AUTHORIZATION', 'NATIVE_UNKNOWN'].includes(error.code));
    v.close();
  }
  const late = controlledAgent({ autoApiCompletion: false, request: method => method === 'account/login/start' ? { type: 'apiKey' } : { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  const work = late.login({ type: 'apiKey', apiKey: 'owned-provider-key' }); void work.catch(() => {});
  await wait(() => late.frames.length === 1); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(late.emit({ method: 'account/login/completed', params: { loginId: null, success: false } }), true);
  await assert.rejects(work, { code: 'AUTHORIZATION' });
});

Then('native login cancellation rejects late success malformed acknowledgements and post-guard cancellation', async () => {
  for (const mode of ['negative-event', 'positive-event', 'invalid-result', 'aborted']) {
    let finishCancel, guards = 0;
    const controller = new AbortController(), v = controlledAgent({ request(method) {
      if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'login_owned', authUrl: 'https://owned.example.test/authorize' };
      if (method === 'account/login/cancel') return new Promise(resolve => { finishCancel = resolve; });
      return { account: { type: 'chatgpt', email: null, planType: 'unknown' }, requiresOpenaiAuth: true };
    } });
    const work = v.login({ type: 'chatgpt' }); void work.catch(() => {}); await wait(() => v.notices.length === 1);
    const cancel = v.agent.cancelLogin(v.connection, {}, async () => { if (++guards === 2 && mode === 'aborted') controller.abort(); }, controller.signal); void cancel.catch(() => {});
    await wait(() => finishCancel);
    if (mode.endsWith('-event')) assert.equal(v.emit({ method: 'account/login/completed', params: { loginId: 'login_owned', success: mode === 'positive-event' } }), mode === 'negative-event');
    finishCancel({ status: mode === 'invalid-result' ? 'unreviewed' : 'canceled' });
    if (mode === 'invalid-result' || mode === 'aborted') await assert.rejects(cancel, { code: mode === 'aborted' ? 'CANCELLED' : 'AUTHORIZATION' });
    else assert.deepEqual(await cancel, { status: 'canceled' });
    await assert.rejects(work, { code: mode === 'negative-event' ? 'CANCELLED' : 'NATIVE_UNKNOWN' }); v.close();
  }
});

Then('native logout and hidden provider accounts retain final confirmation authority', async () => {
  for (const mode of ['account', 'closed', 'aborted']) {
    let guards = 0; const controller = new AbortController();
    const v = controlledAgent({ request: method => method === 'account/logout' ? {} : { account: mode === 'account' ? { type: 'apiKey' } : null, requiresOpenaiAuth: true },
      guard: owner => { if (++guards === 2) { if (mode === 'closed') owner.close(); else if (mode === 'aborted') controller.abort(); } } });
    await assert.rejects(v.agent.logout(v.connection, 'K'.repeat(43), 'c'.repeat(64), v.guard, controller.signal), { code: mode === 'account' ? 'AUTHORIZATION' : 'CANCELLED' }); v.close();
  }
  const hidden = controlledAgent({ scope: 'codex-account-auth', request: method => method === 'account/login/start' ? { type: 'apiKey' } : { account: null, requiresOpenaiAuth: false } });
  const result = await hidden.login({ type: 'apiKey', apiKey: 'owned-hidden-provider-key' });
  assert.equal(result.accountType, 'none'); assert.equal(result.requiresOpenaiAuth, false); hidden.close();
});

Then('native configuration and migration receipts retain peer identity and guards before and after adoption', async () => {
  const configInput = { keyPath: 'model', value: 'owned', mergeStrategy: 'replace' }, migrationInput = { migrationItems: [{ itemType: 'CONFIG', description: 'Owned controlled import' }] };
  for (const method of ['config/value/write', 'externalAgentConfig/import']) for (const mode of ['peer', 'before-close', 'before-cancel', 'after-close', 'after-cancel']) {
    let guards = 0, adopted = 0;
    const controller = new AbortController(), importing = method === 'externalAgentConfig/import', params = importing ? migrationInput : configInput;
    const v = controlledAgent({ request: async (selected, input, owner, requestId) => {
      assert.equal(selected, method);
      const result = importing ? { importId: randomUUID() } : {}, receipt = { type: 'authority', reason: importing ? 'migration' : 'configuration', requestId, method,
        paramsHash: await nativeConfigurationWriteHash(input), resultHash: await nativeConfigurationWriteHash(result), beforeConfiguration: owner.identity.configuration,
        identity: { ...owner.identity, configuration: 'e'.repeat(64) }, ...(importing ? { effectHash: 'f'.repeat(64), privateValues: [] } : {}) };
      assert.equal(owner.emit(receipt), true); if (mode !== 'peer') Object.assign(owner.identity, receipt.identity); return result;
    }, guard: owner => {
      guards++;
      if (guards === (mode.startsWith('before') ? 2 : 3)) {
        if (mode.endsWith('close')) owner.close(); else if (mode.endsWith('cancel')) controller.abort();
      }
    } });
    const adopt = async () => { adopted++; };
    await assert.rejects(v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), method, params, v.guard, controller.signal, undefined, adopt, adopt),
      { code: mode === 'peer' ? 'AUTHORIZATION' : mode.endsWith('cancel') ? 'CANCELLED' : 'NATIVE_UNKNOWN' });
    assert.equal(adopted, mode.startsWith('after') ? 1 : 0); v.close();
  }
  for (const [method,params] of [['plugin/share/save', { pluginPath: '/owned/plugin' }], ['plugin/install', { pluginName: 'owned', marketplacePath: '/owned/marketplace' }], ['marketplace/add', { source: 'owned/repository' }]]) {
    let adopted = 0;
    const v = controlledAgent({ request: async (selected, input, owner, requestId) => {
      const result = {}, receipt = { type: 'authority', reason: 'configuration', requestId, method: selected,
        paramsHash: await nativeConfigurationWriteHash(input), resultHash: await nativeConfigurationWriteHash(result), beforeConfiguration: owner.identity.configuration,
        identity: { ...owner.identity, configuration: 'e'.repeat(64) } };
      assert.equal(owner.emit(receipt), true); Object.assign(owner.identity, receipt.identity); return result;
    } });
    assert.deepEqual(await v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), method, params, v.guard, undefined, undefined, async () => { adopted++; }), {});
    assert.equal(adopted, 1); v.close();
  }
});

function controlledShell(options = {}) {
  const params = { threadId: 'thread_1', command: 'printf owned', timeoutMs: 300000 };
  const v = controlledAgent({ ...options, request: options.request ?? (() => ({})) });
  v.startShell = signal => {
    const work = v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), 'thread/shellCommand', params, v.guard, signal, notice => v.notices.push(notice));
    void work.catch(() => {}); return work;
  };
  v.shellApproval = () => ({ id: 'shell_approval', method: 'operations/threadShell/requestApproval', params: { requestId: v.currentRequest.requestId, params, unsandboxed: true } });
  v.approveShell = async () => { assert.equal(v.emit(v.shellApproval()), true); await v.agent.reply(v.connection.id, v.notices[0].token, 'accept'); };
  v.shellTurn = (status = 'started') => ({ method: 'turn/' + status, params: { threadId: 'thread_1', turn: { id: 'turn_1', items: [], status: status === 'started' ? 'inProgress' : 'completed' } } });
  v.shellItem = () => ({ method: 'item/started', params: { threadId: 'thread_1', turnId: 'turn_1', item: { id: 'item_1', type: 'commandExecution', source: 'userShell', command: 'printf owned', cwd: '/owned', commandActions: [], status: 'inProgress' } } });
  return v;
}

Then('native shell events cannot precede approval duplicate ownership or omit their command completion', async () => {
  for (const mode of ['approval', 'item-before-approval', 'turn-before-approval', 'item-duplicate', 'turn-duplicate', 'completion-without-item', 'unsupported']) {
    const v = controlledShell(), work = v.startShell(); await wait(() => v.frames.length === 1);
    let frame;
    if (mode === 'approval') { frame = v.shellApproval(); frame.params.unsandboxed = false; }
    else if (mode === 'item-before-approval') frame = v.shellItem();
    else if (mode === 'turn-before-approval') frame = v.shellTurn();
    else {
      await v.approveShell(); assert.equal(v.emit(v.shellTurn()), true);
      if (mode === 'item-duplicate') { assert.equal(v.emit(v.shellItem()), true); frame = v.shellItem(); }
      if (mode === 'turn-duplicate') frame = v.shellTurn();
      if (mode === 'completion-without-item') frame = v.shellTurn('completed');
      if (mode === 'unsupported') frame = { id: 'foreign_permission', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', command: 'pwd' } };
    }
    assert.equal(v.emit(frame), false); await assert.rejects(work, { code: 'NATIVE_UNKNOWN' }); v.close();
  }
  const controller = new AbortController(), failing = controlledShell({ request(method) { if (method === 'turn/interrupt') throw new Error('controlled interrupt failed'); return {}; } });
  const work = failing.startShell(controller.signal); await wait(() => failing.frames.length === 1); await failing.approveShell(); failing.emit(failing.shellTurn()); controller.abort();
  await assert.rejects(work, { code: 'NATIVE_UNKNOWN' }); assert.equal(failing.frames.filter(frame => frame.method === 'turn/interrupt').length, 1); failing.close();
});

Then('native Guardian and review hints cannot acquire a different active thread or reviewer', async () => {
  for (const frame of [
    { id: 'guardian_approval', method: 'operations/guardian/approve', params: { requestId: 'foreign', denial: {} } },
    { method: 'item/autoApprovalReview/started', params: { threadId: 'thread_1' } }
  ]) {
    const v = controlledAgent(), work = v.execute(); void work.catch(() => {}); await wait(() => v.notices.length === 1);
    assert.equal(v.emit(frame), false); await assert.rejects(work, { code: 'NATIVE_UNKNOWN' }); v.close();
  }
  for (const auto of [true, false]) {
    const v = controlledAgent({ request: () => ({ thread: { id: 'thread_1' }, approvalsReviewer: auto ? 'user' : 'auto_review' }) });
    await assert.rejects(v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), 'thread/start', auto ? { approvalsReviewer: 'auto_review' } : {}, v.guard), { code: 'AUTHORIZATION' }); v.close();
  }
  const review = controlledAgent({ request: () => ({ reviewThreadId: 'thread_1', turn: { id: 'turn_1', items: [], status: 'inProgress' } }) });
  const work = review.agent.execute(review.connection, 'K'.repeat(43), 'c'.repeat(64), 'review/start', { threadId: 'thread_1', target: { type: 'uncommittedChanges' } }, review.guard); void work.catch(() => {});
  await wait(() => review.frames.length === 1); assert.equal(review.emit({ method: 'turn/started', params: { threadId: 'thread_1', turn: { id: '' } } }), false);
  await assert.rejects(work, { code: 'NATIVE_UNKNOWN' }); review.close();
});

Then('native turn controls retain guard cancellation terminal and concurrent control authority', async () => {
  const steer = { threadId: 'thread_1', expectedTurnId: 'turn_1', input: [{ type: 'text', text: 'owned steering' }] };
  for (const mode of ['guard', 'before-abort', 'after-abort', 'terminal']) {
    const v = controlledAgent({ request: method => method === 'turn/start' ? { turn: { id: 'turn_1' } } : method === 'turn/steer' ? { turnId: 'turn_1' } : {} }), controller = new AbortController();
    const work = v.execute(); void work.catch(() => {}); await wait(() => v.notices.length === 1); let guards = 0;
    const fault = new Error('controlled source guard failed');
    const guard = async () => { guards++; if (mode === 'guard') throw fault; if (guards === (mode === 'before-abort' ? 1 : 2) && mode.endsWith('abort')) controller.abort(); };
    const control = v.agent.control(v.connection, 'c'.repeat(64), mode === 'terminal' ? 'turn/interrupt' : 'turn/steer', mode === 'terminal' ? { threadId: 'thread_1', turnId: 'turn_1' } : steer, guard, controller.signal); void control.catch(() => {});
    if (mode === 'terminal') { await wait(() => v.frames.length === 2); v.emit({ method: 'turn/completed', params: { threadId: 'thread_1', turn: { id: 'turn_1', items: [], status: 'completed' } } }); }
    await assert.rejects(control, mode === 'guard' ? error => error === fault : { code: mode === 'before-abort' ? 'CANCELLED' : 'AUTHORIZATION' });
    if (mode === 'terminal') assert.equal((await work).turn.status, 'completed');
    else { v.close(); await assert.rejects(work, { code: 'NATIVE_UNKNOWN' }); } v.close();
  }
  const releases = [], capped = controlledAgent({ request: method => method === 'turn/start' ? { turn: { id: 'turn_1' } } : new Promise(resolve => releases.push(resolve)) });
  const work = capped.execute(); void work.catch(() => {}); await wait(() => capped.notices.length === 1);
  const controls = Array.from({ length: 4 }, () => capped.agent.control(capped.connection, 'c'.repeat(64), 'turn/steer', steer, capped.guard));
  await wait(() => releases.length === 4); await assert.rejects(capped.agent.control(capped.connection, 'c'.repeat(64), 'turn/steer', steer, capped.guard), { code: 'PERMISSION' });
  capped.emit({ method: 'turn/completed', params: { threadId: 'thread_1', turn: { id: 'turn_1', items: [], status: 'completed' } } });
  await new Promise(resolve => setTimeout(resolve, 0)); releases.forEach(release => release({ turnId: 'turn_1' }));
  await Promise.all(controls); assert.equal((await work).turn.status, 'completed'); capped.close();
});

Then('native agent connection and final login guards retain the current active owner', async () => {
  let release, connecting = 0;
  const v = controlledAgent({ connect: () => ++connecting === 1 ? new Promise(resolve => { release = resolve; }) : undefined });
  const first = v.execute('thread/start'); void first.catch(() => {}); await wait(() => release);
  const current = v.execute(); void current.catch(() => {}); await wait(() => v.notices.length === 1); release();
  await assert.rejects(first, { code: 'CONFLICT' }); v.close(); await assert.rejects(current, { code: 'NATIVE_UNKNOWN' });
  let guards = 0;
  const login = controlledAgent({ request: method => method === 'account/login/start' ? { type: 'apiKey' } : { account: { type: 'apiKey' }, requiresOpenaiAuth: true },
    guard: owner => { if (++guards === 2) owner.close(); } });
  await assert.rejects(login.login({ type: 'apiKey', apiKey: 'owned-provider-key' }), { code: 'NATIVE_UNKNOWN' }); login.close();
  let stale = false; const fault = new Error('private stale source');
  const approvals = controlledAgent({ guard: () => { if (stale) throw fault; } }), running = approvals.execute(); void running.catch(() => {});
  await wait(() => approvals.notices.length === 1);
  assert.equal(approvals.emit({ id: 'approval_owned', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', command: 'pwd' } }), true);
  stale = true;
  await assert.rejects(approvals.agent.reply(approvals.connection.id, approvals.notices.find(notice => notice.kind === 'approval').interaction.token, 'accept'), error => error === fault);
  await assert.rejects(running, { code: 'NATIVE_UNKNOWN' }); approvals.close();
});

Then('native Guardian acknowledgement and approval retain an exact recent denial through the reply guard', async () => {
  for (const mode of ['approved-review', 'unapproved', 'expired', 'changed']) {
    let now = 0, finish, alter = false;
    // Inject the real bounded review cache at the controlled private-worker port.
    // Its existing clock constructor models expiry across an asynchronous guard.
    const book = new NativeGuardianReviews(() => now), notice = guardianFixtureNotice('/owned');
    const started = { ...notice.started, threadId: 'thread_1', turnId: 'turn_1' }, completed = { ...notice.completed, threadId: 'thread_1', turnId: 'turn_1' };
    if (mode === 'approved-review') completed.review = { ...completed.review, status: 'approved' };
    const v = controlledAgent({ connect: owner => { owner.agent.states.get(owner.connection.id).guardian = book; },
      request(method) {
        if (method === 'thread/start') return { thread: { id: 'thread_1' }, approvalsReviewer: 'auto_review' };
        if (method === 'turn/start') return { turn: { id: 'turn_1' } };
        assert.equal(method, nativeGuardianMethod);
        if (mode === 'unapproved') return {};
        return new Promise(resolve => { finish = resolve; });
      }, guard() {
        if (!alter) return; alter = false;
        if (mode === 'expired') now = 600001;
        else {
          book.clear(); const action = { ...started.action, command: 'Changed cached action' };
          book.started({ ...started, action }, 'thread_1', 'turn_1'); book.completed({ ...completed, action }, 'thread_1', 'turn_1');
        }
      } });
    try {
      await v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), 'thread/start', { approvalsReviewer: 'auto_review' }, v.guard);
      const turn = v.execute(); await wait(() => v.notices.some(notice => notice.kind === 'running'));
      assert.equal(v.emit({ method: nativeGuardianStarted, params: started }), true); assert.equal(v.emit({ method: nativeGuardianCompleted, params: completed }), true);
      v.emit({ method: 'turn/completed', params: { threadId: 'thread_1', turn: { id: 'turn_1', items: [], status: 'completed' } } }); await turn;
      if (mode === 'approved-review') { assert.equal(v.notices.some(notice => notice.kind === 'guardian-denial'), false); continue; }
      const params = { threadId: 'thread_1', reviewId: completed.reviewId };
      const work = v.agent.execute(v.connection, 'K'.repeat(43), 'c'.repeat(64), nativeGuardianMethod, params, v.guard, undefined, notice => v.notices.push(notice)); void work.catch(() => {});
      if (mode === 'unapproved') { await assert.rejects(work, { code: 'AUTHORIZATION' }); continue; }
      await wait(() => finish);
      assert.equal(v.emit({ id: 'guardian_owned', method: nativeGuardianApprovalMethod, params: { requestId: v.currentRequest.requestId, denial: book.get(params) } }), true);
      alter = true;
      await assert.rejects(v.agent.reply(v.connection.id, v.notices.find(notice => notice.kind === 'guardian-approval').token, 'accept'), { code: 'AUTHORIZATION' });
      finish({}); await assert.rejects(work, { code: 'AUTHORIZATION' }); assert.deepEqual(v.replies, []);
    } finally { finish?.({}); v.close(); }
  }
});

Then('cancelled native shell guard teardown cannot interrupt or revive a finished owner', async () => {
  for (const failure of [false, true]) {
    let release, reject, held = false, entered = false;
    const gate = new Promise((resolve, no) => { release = resolve; reject = no; }), controller = new AbortController();
    const v = controlledShell({ guard: () => { if (held) { entered = true; return gate; } } });
    const work = v.startShell(controller.signal); await wait(() => v.frames.length === 1); await v.approveShell(); assert.equal(v.emit(v.shellTurn()), true);
    held = true; controller.abort(); await wait(() => entered); v.close(); await assert.rejects(work, { code: 'CANCELLED' });
    if (failure) reject(new Error('controlled stale source')); else release();
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(v.frames.some(frame => frame.method === 'turn/interrupt'), false);
  }
});

Then('cancelling a previous native login ID does not cancel the current owned login', async () => {
  let attempt = 0;
  const v = controlledAgent({ request(method, _params, owner) {
    if (method === 'account/login/start') {
      const loginId = 'login_' + ++attempt;
      if (attempt === 1) owner.emit({ method: 'account/login/completed', params: { loginId, success: true } });
      return { type: 'chatgpt', loginId, authUrl: 'https://owned.example.test/authorize' };
    }
    if (method === 'account/login/cancel') return { status: 'notFound' };
    return { account: { type: 'chatgpt', email: null, planType: 'unknown' }, requiresOpenaiAuth: true };
  } });
  try {
    await v.login({ type: 'chatgpt' });
    const work = v.login({ type: 'chatgpt' }); void work.catch(() => {}); await wait(() => v.notices.some(notice => notice.loginId === 'login_2'));
    assert.deepEqual(await v.agent.cancelLogin(v.connection, { loginId: 'login_1' }, v.guard), { status: 'notFound' });
    assert.equal(v.emit({ method: 'account/login/completed', params: { loginId: 'login_2', success: true } }), true); assert.equal((await work).accountType, 'chatgpt');
  } finally { v.close(); }
});
