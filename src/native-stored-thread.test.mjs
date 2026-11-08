// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeStoredThreadReadMethods, nativeStoredThreadReadParams, nativeStoredThreadReadInputSchema } from './lib/native-stored-thread.ts';
import { nativeStoredThreadSdkFixture } from '../tests/native-stored-thread-sdk.fixture.mjs';
import { nativeStoredThreadFixture } from '../tests/native-stored-thread.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';

Before({ tags: '@native-stored-thread' }, function () { this.storedThreadFixtures = []; });
After({ tags: '@native-stored-thread' }, async function () { for (const c of this.storedThreadFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeStoredThreadFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.storedThreadFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, signal);
  return c;
}
const calls = c => c.f.frames.filter(frame => nativeStoredThreadReadMethods.includes(frame.method));
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);

Then('stored-thread inputs retain all eight read contracts and their nullable filters', function () {
  assert.equal(nativeStoredThreadReadMethods.length, 8);
  for (const method of nativeStoredThreadReadMethods) {
    const p = Object.fromEntries(nativeStoredThreadReadInputSchema(method).required.map(key => [key, 'owned-value']));
    const result = nativeStoredThreadReadParams(method, p);
    assert.deepEqual(Object.keys(result).filter(key => !['limit', 'includeTurns'].includes(key)), Object.keys(p));
  }
  assert.deepEqual(nativeStoredThreadReadParams('thread/list', { cwd: ['.', 'nested'], originators: [], sectionId: null, modelProviders: null, excludedThreadIds: [] }),
    { cwd: ['.', 'nested'], originators: [], sectionId: null, modelProviders: null, excludedThreadIds: [], limit: 8 });
  assert.deepEqual(nativeStoredThreadReadParams('thread/items/list', { threadId: 'owned', turnId: 'visible', cursor: { type: 'item', itemId: 'item-1' }, sortDirection: 'desc' }),
    { threadId: 'owned', turnId: 'visible', cursor: { type: 'item', itemId: 'item-1' }, sortDirection: 'desc', limit: 8 });
  assert.equal(nativeStoredThreadReadParams('thread/read', { threadId: 'owned', includeTurns: true }).includeTurns, true);
  assert.deepEqual(nativeStoredThreadReadParams('thread/list', { sourceKinds: ['vscode'], sortKey: 'recency_at' }).sourceKinds, ['vscode']);
});
Then('stored-thread inputs reject named bad cursors filters pages and thread IDs', function () {
  for (const [method, params, field] of [
    ['thread/read', { threadId: null }, 'threadId'], ['thread/read', { threadId: 'owned', includeTurns: null }, 'includeTurns'],
    ['thread/list', { limit: 65 }, 'limit'], ['thread/list', { originators: ['hosted-only'] }, 'originators'],
    ['thread/list', { cwd: Array(9).fill('.') }, 'cwd'], ['thread/list', { sortDirection: 'sideways' }, 'sortDirection'],
    ['thread/list', { sourceKinds: ['invented'] }, 'sourceKinds'], ['thread/list', { excludedThreadIds: Array(101).fill('id') }, 'excludedThreadIds'],
    ['thread/attachmentOwner/list', { attachmentType: 'x', identityKey: '' }, 'identityKey'],
    ['thread/items/list', { threadId: 'owned', cursor: { type: 'item', itemId: 'item' } }, 'turnId'],
    ['thread/items/list', { threadId: 'owned', turnId: 'turn', cursor: { type: 'item', itemId: '' } }, 'cursor'],
    ['thread/loaded/list', { cursor: 'x'.repeat(2049) }, 'cursor'], ['thread/goal/get', { threadId: 'owned', model: 'override' }, 'model']
  ]) assert.throws(() => nativeStoredThreadReadParams(method, params), error => error.field === field, method + ':' + field);
  let reads = 0; const values = []; Object.defineProperty(values, '0', { enumerable: true, get() { reads++; return 'cli'; } });
  assert.throws(() => nativeStoredThreadReadParams('thread/list', { sourceKinds: values }), error => error.field === 'sourceKinds'); assert.equal(reads, 0);
});
Then('the pinned SDK reads its owned persisted thread history goals and attachments', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture();
  try {
    const start = await f.call('thread/start', { model: 'owned-fixture-model', approvalPolicy: 'on-request', approvalsReviewer: 'user' }), threadId = start.thread.id;
    assert.equal(start.cwd, f.workspace);
    await f.call('thread/goal/set', { threadId, objective: 'Owned paused qualification goal', status: 'paused', origin: 'user' });
    await f.call('thread/inject_items', { threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Owned stored-thread fixture user message' }] }] });
    await f.call('thread/attachment/add', { threadId, attachmentType: 'qualification', identityKey: 'owned-item', payload: { fixture: true } });
    const terminal = f.notification('turn/completed', params => params.threadId === threadId);
    await f.call('thread/shellCommand', { threadId, command: 'printf OWNED_STORED_THREAD_HISTORY' });
    const turn = (await terminal).turn; assert.equal(turn.status, 'completed');
    const loaded = await f.call('thread/loaded/list', { limit: 8 }); assert.ok(loaded.data.includes(threadId));
    const read = await f.call('thread/read', { threadId, includeTurns: true });
    assert.equal(read.thread.id, threadId); assert.equal(read.thread.cwd, f.workspace);
    assert.ok(JSON.stringify(read).includes('OWNED_STORED_THREAD_HISTORY'));
    const listed = await f.call('thread/list', { cwd: f.workspace, sourceKinds: [], modelProviders: [], limit: 8 });
    assert.ok(listed.data.some(thread => thread.id === threadId), JSON.stringify({ listed,
      thread: { id: threadId, source: read.thread.source, modelProvider: read.thread.modelProvider, historyMode: read.thread.historyMode } }));
    const turns = await f.call('thread/turns/list', { threadId, itemsView: 'full', limit: 8 }); assert.ok(turns.data.some(t => t.id === turn.id));
    const items = await f.call('thread/items/list', { threadId, turnId: turn.id, limit: 8 }); assert.ok(items.data.length);
    const goal = await f.call('thread/goal/get', { threadId }); assert.equal(goal.goal.status, 'paused'); assert.equal(goal.goal.objective, 'Owned paused qualification goal');
    const attachments = await f.call('thread/attachment/list', { threadId, limit: 8 }); assert.deepEqual(attachments.data[0].payload, { fixture: true });
    const owners = await f.call('thread/attachmentOwner/list', { attachmentType: 'qualification', identityKey: 'owned-item', limit: 8 }); assert.ok(owners.data.some(owner => owner.threadId === threadId));
    assert.ok(f.provider.requests.every(path => path === '/v1/models'));
    assert.ok(nativeStoredThreadReadMethods.every(method => f.calls.some(call => call.method === method)));
  } finally { await f.close(); }
});

Then('stored-thread models roundtrip their graphs and identify offending fields', async function () {
  const c = await setup(this);
  for (const method of nativeStoredThreadReadMethods) {
    const selected = c.select(method), graph = createOperationGraph(selected.operation, { x: 0, y: 0 }, 'owner', selected.document);
    const doc = { version: 3, id: 'stored-thread', name: 'Stored thread', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    assert.equal(selected.operation.unavailableReason, undefined);
    assert.ok(selected.operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!selected.operation.capabilities.requirements.some(r => ['native-account', 'native-terminal', 'native-workspace'].includes(r.code)));
  }
  assert.equal(c.select('thread/list').operation.fields.find(f => f.name === 'cwd').type, 'json');
  assert.equal(c.select('thread/items/list').operation.fields.find(f => f.name === 'cursor').type, 'json');
  assert.deepEqual(prepareNativeRequest(c.select('thread/list').operation, { 'params:cwd': '["."]' }).params.cwd, ['.']);
  for (const [method, values, key] of [
    ['thread/list', { 'params:limit': '65' }, 'params:limit'], ['thread/list', { 'params:cwd': '[false]' }, 'params:cwd'],
    ['thread/read', { 'params:threadId': 'owned', 'params:includeTurns': '42' }, 'params:includeTurns'],
    ['thread/items/list', { 'params:threadId': 'owned', 'params:cursor': '{"type":"item","itemId":"i"}' }, 'params:turnId']
  ]) assert.throws(() => prepareNativeRequest(c.select(method).operation, values), error => error.fieldKey === key);
});
async function allReads(world, real) {
  const c = await setup(world, { real });
  assert.equal(c.connection.accountType, 'none'); assert.equal(c.connection.requiresOpenaiAuth, real ? false : true); assert.equal(c.connection.workflowFingerprint, undefined);
  for (const method of nativeStoredThreadReadMethods) {
    const params = method === 'thread/list' || method === 'thread/loaded/list' ? {}
      : method === 'thread/attachmentOwner/list' ? { attachmentType: 'qualification', identityKey: 'owned-item' }
        : { threadId: c.f.seed.threadId, ...(method === 'thread/read' ? { includeTurns: true } : {}) };
    let result;
    try { result = await c.execute(method, params); }
    catch (error) { error.message += '\nStored-thread method: ' + method + '\nOwned fixture shapes: ' + JSON.stringify(c.f.resultShapes); throw error; }
    assert.equal(result.response.protocol, 'json-rpc');
    if (method === 'thread/read') { assert.equal(result.response.result.thread.id, c.f.seed.threadId); if (real) assert.ok(JSON.stringify(result).includes('OWNED_STORED_THREAD_HISTORY')); }
    if (method === 'thread/list') assert.ok(result.response.result.data.some(thread => thread.id === c.f.seed.threadId));
    if (real && method === 'thread/goal/get') assert.equal(result.response.result.goal.status, 'paused');
    if (real && method === 'thread/attachment/list') assert.deepEqual(result.response.result.data[0].payload, { fixture: true });
    if (real && method === 'thread/attachmentOwner/list') assert.ok(result.response.result.data.some(row => row.threadId === c.f.seed.threadId));
  }
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1); assert.equal(calls(c).length, 8);
  assert.ok(!c.f.frames.some(frame => ['thread/start', 'thread/resume', 'turn/start', 'account/login/start'].includes(frame.method)));
  if (real) assert.ok([...c.f.setupRequests, ...c.f.provider.requests].every(path => path === '/v1/models'));
}
Then('all eight stored-thread reads share the independently granted paired child', async function () { await allReads(this, false); });
Then('the private vault reads all eight stored-thread methods through the actual SDK', { timeout: 45000 }, async function () { await allReads(this, true); });
Then('stored-thread reads reject missing grants escapes and execution escalation', { timeout: 60000 }, async function () {
  const denied = await setup(this, { allowThreadsRead: false, allowAgent: true }); await assert.rejects(denied.execute('thread/list')); assert.equal(calls(denied).length, 0);
  for (const cwd of ['../home', '/outside']) { const c = await setup(this); await assert.rejects(c.execute('thread/list', { cwd })); assert.equal(calls(c).length, 0); }
  const escaped = await setup(this); await symlink(escaped.f.home, join(escaped.f.workspace, 'escape')); await assert.rejects(escaped.execute('thread/list', { cwd: ['escape'] })); assert.equal(calls(escaped).length, 0);
  const c = await setup(this, { allowAgent: true, requiresOpenaiAuth: false }), foreign = randomUUID(); c.f.storedThreads.set(foreign, { ...c.f.storedThreads.get(c.f.seed.threadId), id: foreign, cwd: c.f.home });
  assert.deepEqual((await c.execute('thread/loaded/list')).response.result.data, [c.f.seed.threadId]);
  assert.deepEqual((await c.execute('thread/attachmentOwner/list', { attachmentType: 'fixture', identityKey: 'item' })).response.result.data.map(row => row.threadId), [c.f.seed.threadId]);
  c.connection = await c.v.session.enableNativeWorkflow(c.reference, c.selections); c.reference = nativeReference(c.connection);
  await c.execute('thread/read', { threadId: c.f.seed.threadId });
  await assert.rejects(c.execute('turn/start', { threadId: c.f.seed.threadId, input: [{ type: 'text', text: 'Unowned execution must be rejected.' }] }));
  assert.ok(!c.f.frames.some(frame => frame.method === 'turn/start'));
  const scoped = await setup(this); scoped.f.storedThreads.get(scoped.f.seed.threadId).cwd = scoped.f.home;
  await assert.rejects(scoped.execute('thread/goal/get', { threadId: scoped.f.seed.threadId })); assert.equal(calls(scoped).length, 0);
});
Then('stored-thread reads withhold foreign results oversized pages and encoded credentials', { timeout: 60000 }, async function () {
  for (const mode of ['foreign', 'oversized', 'unknown', 'plain', 'base64', 'utf16']) {
    const c = await setup(this), id = c.f.seed.threadId;
    if (mode === 'foreign') c.f.readResult = { thread: { ...c.f.storedThreads.get(id), id: randomUUID() }, readState: null };
    else if (mode === 'oversized') c.f.readResult = { data: Array(9).fill(id), nextCursor: null };
    else if (mode === 'unknown') c.f.readResult = { goal: null, privateExtra: 'Unclassified native text' };
    else {
      const secret = 'owned-stored-thread-secret-' + randomUUID(); await c.v.session.put(null, { kind: 'secret', label: 'Stored-thread privacy fixture', value: secret });
      const value = mode === 'base64' ? Buffer.from(secret).toString('base64') : mode === 'utf16' ? Buffer.from(secret, 'utf16le').toString('utf8') : secret;
      c.f.readResult = { data: [{ id: 'attachment', attachmentType: 'qualification', identityKey: 'item', createdAt: 1, payload: { nested: [value] } }], nextCursor: null };
    }
    const method = mode === 'foreign' ? 'thread/read' : mode === 'oversized' ? 'thread/loaded/list' : mode === 'unknown' ? 'thread/goal/get' : 'thread/attachment/list';
    await assert.rejects(c.execute(method, method === 'thread/loaded/list' ? {} : { threadId: id })); await ended(c); assert.equal(calls(c).length, 1);
  }
});
Then('pending stored-thread reads reject cancellation source changes and changed identities', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'lock']) {
    const c = await setup(this), controller = new AbortController(); c.f.holdReads = true;
    const pending = c.execute('thread/read', { threadId: c.f.seed.threadId }, controller.signal); void pending.catch(() => {});
    await waitForWatch(() => c.f.release.length === 1);
    if (mode === 'cancel') controller.abort(); else if (mode === 'source') c.v.enabled = false; else if (mode === 'identity') c.f.identity.generation = randomUUID(); else c.v.session.lock();
    if (mode === 'source' || mode === 'identity') c.f.release[0]();
    await assert.rejects(pending); await ended(c); assert.equal(calls(c).length, 1);
  }
});
Then('stored-thread schemas retain reviewed native extensions and reject unknown implementation data', async function () {
  const c = await setup(this), thread = { ...c.f.storedThreads.get(c.f.seed.threadId), environments: [{ environmentId: 'owned', cwd: c.f.workspace, runtimeWorkspaceRoots: [c.f.workspace] }],
    extra: {}, canAcceptDirectInput: false, daybreakEnabled: null };
  const receipt = { revision: 'owned-revision', firstUnread: { type: 'turn', turnId: 'owned-turn' } };
  for (const method of ['thread/read', 'thread/list']) {
    const selected = c.select(method), result = method === 'thread/read' ? { thread, readState: receipt } : { data: [thread], readStates: { [thread.id]: receipt } };
    assert.deepEqual(validateNativeQueryResult(result, selected.operation.rpc.workflowResult, selected.document, true), result);
    for (const bad of [{ ...thread, extra: { unknownPrivateData: 'unclassified' } }, { ...thread, environments: [{ environmentId: 'owned', cwd: c.f.workspace, unknown: true }] }, { ...thread, daybreakEnabled: 'false' }]) {
      const malformed = method === 'thread/read' ? { ...result, thread: bad } : { ...result, data: [bad] };
      assert.throws(() => validateNativeQueryResult(malformed, selected.operation.rpc.workflowResult, selected.document, true), error => error.code === 'NATIVE_CONTRACT');
    }
  }
});
