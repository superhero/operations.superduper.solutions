// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { nativeStoredThreadSdkFixture } from '../tests/native-stored-thread-sdk.fixture.mjs';
import { nativeThreadLifecycleMethods, isNativeThreadLifecycleMethod, nativeThreadLifecycleParams, nativeThreadLifecycleResultSchema } from './lib/native-thread-lifecycle.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';
import { nativeThreadTree } from '../companions/codex/thread-tree.mjs';
import { nativeMigrationStateDatabase } from '../companions/codex/migration-history.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { nativeStoredThreadFixture } from '../tests/native-stored-thread.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Then('the pinned lifecycle methods pass the paired encrypted workflow broker without inference', { timeout: 60000 }, async function () {
  const f = await nativeStoredThreadFixture({ real: true, allowAgent: true, allowThreadsWrite: true }), v = await nativeVaultFixture(f);
  try {
    const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection);
    let reference = nativeReference(paired);
    const execute = (method, input) => v.session.executeNativeRuntime(reference, selections, selections.find(s => s.operation.rpc.method === method), input);
    await assert.rejects(execute('thread/fork', { threadId: f.seed.threadId }), error => error.code === 'AUTHORIZATION');
    const enabled = await v.session.enableNativeWorkflow(reference, selections); reference = nativeReference(enabled);
    const threadId = (await execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
    await execute('thread/archive', { threadId }); await execute('thread/unarchive', { threadId }); await execute('thread/resume', { threadId });
    await execute('thread/name/set', { threadId, name: 'Owned encrypted lifecycle' });
    const metadata = await execute('thread/metadata/update', { threadId, gitInfo: { branch: 'owned-encrypted', originUrl: null } });
    assert.equal(metadata.response.result.thread.gitInfo.branch, 'owned-encrypted');
    await execute('thread/section/move', { threadId, sectionId: null });
    const fork = await execute('thread/fork', { threadId }), forkId = fork.response.result.thread.id; assert.notEqual(forkId, threadId);
    assert.equal(fork.response.result.activePermissionProfile.id, 'operations');
    await execute('thread/unsubscribe', { threadId: forkId }); await execute('thread/delete', { threadId: forkId });
    await execute('thread/delete', { threadId });
    assert.ok(nativeThreadLifecycleMethods.every(method => f.frames.some(frame => frame.method === method)));
    assert.ok(!f.frames.some(frame => frame.method === 'account/login/start' || frame.method === 'turn/start'));
    assert.ok(f.provider.requests.every(path => path === '/v1/models'));
    for (const method of nativeThreadLifecycleMethods) {
      const selected = selections.find(s => s.operation.rpc.method === method);
      assert.equal(selected.operation.unavailableReason, undefined);
      const graph = createOperationGraph(selected.operation, { x: 0, y: 0 }, 'lifecycle', selected.document);
      const doc = { version: 3, id: 'lifecycle', name: 'Lifecycle', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
      assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    }
    const selected = selections.find(s => s.operation.rpc.method === 'thread/metadata/update');
    assert.deepEqual(prepareNativeRequest(selected.operation, { 'params:threadId': threadId, 'params:gitInfo': '{"branch":null}' }).params.gitInfo, { branch: null });
    assert.throws(() => prepareNativeRequest(selected.operation, { 'params:threadId': threadId, 'params:gitInfo': '{"branch":false}' }), error => error.fieldKey === 'params:gitInfo');
  } finally { v.session.lock(); await f.close(); }
});

Then('lifecycle dispatch preserves agent ownership and revokes execution until explicit resume', async function () {
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const root = randomUUID(), child = randomUUID(), foreign = randomUUID(), threads = new Map(), sent = [];
  let prepares = 0;
  const settings = { identity, authority: async () => ({ ...identity }), threads, send: frame => sent.push(frame), write() {},
    async prepareThreadLifecycle(method, input) { prepares++; return { method, input, params: input, ids: [root, child] }; },
    reviewThreadLifecycle: async (_plan, value) => value };
  const denied = createCodexAgentSession({ ...settings, allowThreadsWrite: false });
  await assert.rejects(denied.request({ id: 'denied', method: 'thread/name/set', params: { threadId: root, name: 'Owned' } })); assert.equal(prepares, 0); denied.close();
  const service = createCodexAgentSession({ ...settings, allowAgent: false, allowThreadsWrite: true });
  await assert.rejects(service.request({ id: 'forkDenied', method: 'thread/fork', params: { threadId: root } }));
  await service.request({ id: 'service', method: 'thread/name/set', params: { threadId: root, name: 'Owned' } });
  await service.receive({ id: 'service', result: {} }); assert.equal(threads.size, 0); service.close();
  const agent = createCodexAgentSession({ ...settings, allowThreadsWrite: true });
  for (const [index, id] of [root, child].entries()) {
    await agent.request({ id: 'start' + index, method: 'thread/start', params: {} });
    await agent.receive({ id: 'start' + index, result: { thread: { id } } });
  }
  await assert.rejects(agent.request({ id: 'foreign', method: 'thread/fork', params: { threadId: foreign } }));
  await agent.request({ id: 'archive', method: 'thread/archive', params: { threadId: root } });
  await assert.rejects(agent.request({ id: 'parallel', method: 'thread/name/set', params: { threadId: root, name: 'Busy' } }));
  await agent.receive({ id: 'archive', error: { code: -1, message: 'Private SDK details' } });
  assert.equal(JSON.stringify(sent).includes('Private SDK details'), false);
  for (const id of [root, child]) {
    await assert.rejects(agent.request({ id: 'stale', method: 'turn/start', params: { threadId: id, input: [{ type: 'text', text: 'stale' }] } }));
    await assert.rejects(agent.request({ id: 'staleFork', method: 'thread/fork', params: { threadId: id } }));
  }
  await agent.request({ id: 'resume', method: 'thread/resume', params: { threadId: root } });
  await agent.receive({ id: 'resume', result: { thread: { id: root } } });
  const forkId = randomUUID(); await agent.request({ id: 'fork', method: 'thread/fork', params: { threadId: root } });
  await agent.receive({ id: 'fork', result: { thread: { id: forkId } } }); assert.ok(threads.has(forkId));
  await agent.request({ id: 'delete', method: 'thread/delete', params: { threadId: root } }); await agent.receive({ id: 'delete', result: {} });
  assert.equal(threads.has(root), false); assert.equal(threads.has(child), false); assert.ok(threads.has(forkId)); agent.close();
});

Then('paired lifecycle metadata requires no agent login and withholds encoded credentials', async function () {
  const f = await nativeStoredThreadFixture({ allowThreadsWrite: true }), v = await nativeVaultFixture(f);
  try {
    const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection), reference = nativeReference(paired);
    assert.equal(paired.accountType, 'none'); assert.equal(paired.requiresOpenaiAuth, true); assert.equal(paired.workflowFingerprint, undefined);
    const execute = (method, params) => v.session.executeNativeRuntime(reference, selections, selections.find(s => s.operation.rpc.method === method), params);
    await execute('thread/name/set', { threadId: f.seed.threadId, name: 'Owned public thread' });
    await execute('thread/section/move', { threadId: f.seed.threadId, sectionId: null });
    await execute('thread/unsubscribe', { threadId: f.seed.threadId });
    assert.equal(f.frames.some(frame => ['thread/start', 'account/login/start', 'turn/start'].includes(frame.method)), false);
    const before = f.frames.filter(frame => frame.method === 'thread/metadata/update').length;
    await assert.rejects(execute('thread/metadata/update', { threadId: f.seed.threadId, gitInfo: { branch: Buffer.from(f.key).toString('base64') } }), error => error.code === 'REDACTED');
    assert.equal(f.frames.filter(frame => frame.method === 'thread/metadata/update').length, before);
    const thread = structuredClone(f.storedThreads.get(f.seed.threadId)); thread.gitInfo = { sha: null, originUrl: null, branch: Buffer.from(f.key, 'utf16le').toString('base64') };
    f.lifecycleResult = { thread };
    await assert.rejects(execute('thread/metadata/update', { threadId: f.seed.threadId, gitInfo: { branch: 'public' } }), error => error.code === 'REDACTED');
  } finally { v.session.lock(); await f.close(); }
});

Then('the pinned SDK renames moves forks unsubscribes archives restores and deletes owned threads', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture({ allowThreadsWrite: true });
  try {
    const source = await readServiceSchema('codex'), call = f.call;
    f.call = async (method, params) => {
      const plan = isNativeThreadLifecycleMethod(method) ? await f.runtime.prepareThreadLifecycle(method, params) : undefined;
      const result = await call(method, plan?.params ?? params);
      if (isNativeThreadLifecycleMethod(method)) validateNativeQueryResult(result, nativeThreadLifecycleResultSchema(method, source), source, true);
      if (plan) await f.runtime.reviewThreadLifecycle(plan, result);
      return result;
    };
    const { threadId } = await f.seed();
    await f.call('thread/name/set', { threadId, name: 'Owned lifecycle thread' });
    await f.call('thread/metadata/update', { threadId, gitInfo: { branch: 'owned-lifecycle', sha: 'a'.repeat(40), originUrl: 'https://example.test/owned.git' } });
    const section = (await f.call('threadSection/create', { name: 'Owned lifecycle section' })).section;
    await f.call('thread/section/move', { threadId, sectionId: section.id });
    let stored = (await f.call('thread/read', { threadId })).thread;
    assert.equal(stored.name, 'Owned lifecycle thread'); assert.equal(stored.gitInfo.branch, 'owned-lifecycle'); assert.equal(stored.section.id, section.id);
    const fork = await f.call('thread/fork', { threadId, excludeTurns: true });
    const forkId = fork.thread.id; assert.notEqual(forkId, threadId); assert.equal(fork.thread.forkedFromId, threadId); assert.equal(fork.cwd, f.workspace);
    assert.equal((await f.call('thread/goal/get', { threadId: forkId })).goal, null, 'Ordinary forks do not opt into goal continuation.');
    assert.equal((await f.call('thread/unsubscribe', { threadId: forkId })).status, 'unsubscribed');
    await f.call('thread/archive', { threadId });
    const archived = await f.call('thread/list', { archived: true, cwd: f.workspace, sourceKinds: [], modelProviders: [], limit: 8 });
    assert.ok(archived.data.some(thread => thread.id === threadId));
    const unarchived = await f.call('thread/unarchive', { threadId }); assert.equal(unarchived.thread.id, threadId);
    stored = (await f.call('thread/read', { threadId })).thread; assert.equal(stored.name, 'Owned lifecycle thread'); assert.equal(stored.gitInfo.branch, 'owned-lifecycle');
    await f.call('thread/delete', { threadId: forkId });
    await assert.rejects(f.call('thread/read', { threadId: forkId }));
    await f.call('thread/section/move', { threadId, sectionId: null }); await f.call('threadSection/delete', { sectionId: section.id });
    assert.equal((await f.call('thread/read', { threadId })).thread.section, null);
    assert.ok(nativeThreadLifecycleMethods.every(method => f.calls.some(call => call.method === method)));
    assert.ok(f.provider.requests.every(path => path === '/v1/models'));
  } finally { await f.close(); }
});
function edge(home, parent, child) {
  const database = new DatabaseSync(join(home, nativeMigrationStateDatabase));
  try { database.prepare('INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status) VALUES (?, ?, ?)').run(parent, child, 'open'); }
  finally { database.close(); }
}
const treeContext = f => ({ sqliteRoot: f.home, home: f.home, workspace: f.workspace,
  inspect: threadId => f.call('thread/read', { threadId, includeTurns: false }), loaded: async () => (await f.call('thread/loaded/list', { limit: 64 })).data });
Then('native thread tree inspection covers the actual SDK archive and delete cascade', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture({ allowThreadsWrite: true });
  try {
    const parent = await f.seed(), child = await f.seed(); edge(f.home, parent.threadId, child.threadId);
    const tree = await nativeThreadTree(parent.threadId, treeContext(f)); assert.deepEqual(tree.ids, [parent.threadId, child.threadId].sort());
    const archive = await f.runtime.prepareThreadLifecycle('thread/archive', { threadId: parent.threadId });
    assert.deepEqual(archive.ids, tree.ids);
    await f.runtime.reviewThreadLifecycle(archive, await f.call('thread/archive', archive.params));
    const archived = await f.call('thread/list', { archived: true, cwd: f.workspace, modelProviders: [], sourceKinds: [], limit: 8 });
    assert.ok(tree.ids.every(id => archived.data.some(thread => thread.id === id)));
    await f.call('thread/unarchive', { threadId: parent.threadId });
    assert.deepEqual((await nativeThreadTree(parent.threadId, treeContext(f))).ids, tree.ids);
    const deletion = await f.runtime.prepareThreadLifecycle('thread/delete', { threadId: parent.threadId }); assert.deepEqual(deletion.ids, tree.ids);
    await f.runtime.reviewThreadLifecycle(deletion, await f.call('thread/delete', deletion.params));
    for (const threadId of tree.ids) await assert.rejects(f.call('thread/read', { threadId }));
    assert.ok(f.provider.requests.every(path => path === '/v1/models'));
  } finally { await f.close(); }
});
Then('native thread tree inspection withholds archive and delete for a foreign real descendant', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture({ allowThreadsWrite: true });
  try {
    const outside = join(f.directory, 'other-workspace'); await mkdir(outside);
    const parent = await f.seed(), child = await f.seed({ cwd: outside }); edge(f.home, parent.threadId, child.threadId);
    for (const method of ['thread/archive', 'thread/delete']) await assert.rejects((async () => {
      await f.runtime.prepareThreadLifecycle(method, { threadId: parent.threadId }); await f.call(method, { threadId: parent.threadId });
    })(), /outside the pairing/);
    assert.ok(!f.calls.some(call => ['thread/archive', 'thread/delete'].includes(call.method)));
    assert.equal((await f.call('thread/read', { threadId: child.threadId })).thread.cwd, outside);
  } finally { await f.close(); }
});
Then('native thread trees include live descendants and reject cyclic oversized or escaping scopes', async function () {
  const directory = await mkdtemp(join(tmpdir(), 'native-thread-tree-')), home = join(directory, 'home'), workspace = join(directory, 'workspace');
  await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
  const database = new DatabaseSync(join(home, nativeMigrationStateDatabase));
  try {
    database.exec('CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT)');
    const root = randomUUID(), child = randomUUID(), live = randomUUID(), threads = new Map([[root, { id: root, cwd: workspace, parentThreadId: null }],
      [child, { id: child, cwd: workspace, parentThreadId: root }], [live, { id: live, cwd: workspace, parentThreadId: child }]]);
    database.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run(root, child, 'closed');
    const context = { home, workspace, sqliteRoot: home, loaded: async () => [live], inspect: async id => ({ thread: structuredClone(threads.get(id)) }) };
    assert.deepEqual((await nativeThreadTree(root, context)).ids, [root, child, live].sort());
    threads.get(root).parentThreadId = live; await assert.rejects(nativeThreadTree(root, context), /cyclic/); threads.get(root).parentThreadId = null;
    threads.get(live).cwd = home; await assert.rejects(nativeThreadTree(root, context), /outside the pairing/); threads.get(live).cwd = workspace;
    database.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run(child, root, 'open'); await assert.rejects(nativeThreadTree(root, context), /cyclic/);
    database.exec('DELETE FROM thread_spawn_edges'); const insert = database.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)');
    for (let index = 0; index < 64; index++) insert.run(root, randomUUID(), 'open');
    await assert.rejects(nativeThreadTree(root, context), /exceeds 64/);
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});
Then('native lifecycle inputs retain fork cutoffs nullable patches and section ordering', function () {
  const threadId = randomUUID();
  for (const method of nativeThreadLifecycleMethods) {
    const input = { threadId, ...(method === 'thread/name/set' ? { name: 'Owned thread' } : method === 'thread/metadata/update' ? { gitInfo: { branch: 'owned', sha: null } }
      : method === 'thread/section/move' ? { sectionId: null } : {}) };
    assert.equal(nativeThreadLifecycleParams(method, input).threadId, threadId);
  }
  assert.deepEqual(nativeThreadLifecycleParams('thread/fork', { threadId, lastTurnId: 'owned-turn', ephemeral: true }), { threadId, lastTurnId: 'owned-turn', ephemeral: true, excludeTurns: true });
  assert.equal(nativeThreadLifecycleParams('thread/metadata/update', { threadId, gitInfo: { originUrl: 'git@example.test:owned/repo.git' } }).gitInfo.originUrl, 'git@example.test:owned/repo.git');
  assert.deepEqual(nativeThreadLifecycleParams('thread/section/move', { threadId, sectionId: 'owned', beforeThreadId: randomUUID() }).sectionId, 'owned');
});
Then('native lifecycle inputs name forbidden overrides and invalid mutation fields', async function () {
  const threadId = randomUUID();
  for (const field of ['cwd', 'path', 'modelProvider', 'sandbox', 'permissions', 'approvalPolicy', 'approvalsReviewer', 'baseInstructions', 'developerInstructions', 'config', 'deferGoalContinuation'])
    assert.throws(() => nativeThreadLifecycleParams('thread/fork', { threadId, [field]: 'foreign' }), error => error.field === field);
  for (const [method, input, field] of [
    ['thread/name/set', { threadId, name: ' ' }, 'name'], ['thread/name/set', { threadId, name: 'a'.repeat(201) }, 'name'],
    ['thread/fork', { threadId, ephemeral: true, excludeTurns: false }, 'excludeTurns'],
    ['thread/section/move', { threadId, sectionId: null, beforeThreadId: randomUUID() }, 'beforeThreadId'],
    ['thread/metadata/update', { threadId, gitInfo: {} }, 'gitInfo'], ['thread/metadata/update', { threadId, gitInfo: { branch: false } }, 'gitInfo'],
    ['thread/metadata/update', { threadId, gitInfo: { originUrl: 'https://user:password@example.test/repo.git' } }, 'gitInfo'],
    ['thread/metadata/update', { threadId, gitInfo: { originUrl: 'https://example.test/repo.git?token=private' } }, 'gitInfo']
  ]) assert.throws(() => nativeThreadLifecycleParams(method, input), error => error.field === field);
  const source = await readServiceSchema('codex');
  for (const [method, result] of [['thread/archive', { privateExtra: 'unclassified' }], ['thread/unsubscribe', { status: 'unsubscribed', privateExtra: 'unclassified' }], ['thread/unsubscribe', { status: 'invented' }]])
    assert.throws(() => validateNativeQueryResult(result, nativeThreadLifecycleResultSchema(method, source), source, true), error => error.code === 'NATIVE_CONTRACT');
});
