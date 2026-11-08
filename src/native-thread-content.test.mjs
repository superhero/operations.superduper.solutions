// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeStoredThreadSdkFixture } from '../tests/native-stored-thread-sdk.fixture.mjs';
import { nativeThreadContentMethods, isNativeThreadContentMethod, nativeThreadContentParams, nativeThreadContentResultSchema } from './lib/native-thread-content.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';
import { nativeStoredThreadFixture } from '../tests/native-stored-thread.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Then('content forms preserve opaque item JSON nullable budgets and their saved graph contracts', async function () {
  const source = await readServiceSchema('codex'), operations = new Map();
  for (const method of nativeThreadContentMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method); operations.set(method, operation);
    assert.equal(operation.unavailableReason, undefined);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'content', document), doc = { version: 3, id: 'content-model', name: 'Content model', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
  }
  const threadId = randomUUID(), items = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Owned form history' }] }];
  assert.deepEqual(prepareNativeRequest(operations.get('thread/inject_items'), { 'params:threadId': threadId, 'params:items': JSON.stringify(items) }).params.items, items);
  assert.equal(prepareNativeRequest(operations.get('thread/goal/set'), { 'params:threadId': threadId, 'params:tokenBudget': null }).params.tokenBudget, null);
  assert.deepEqual(prepareNativeRequest(operations.get('thread/attachment/add'), { 'params:threadId': threadId, 'params:attachmentType': 'owned', 'params:identityKey': 'item', 'params:payload': '[null,false,7,{"nested":true}]' }).params.payload, [null, false, 7, { nested: true }]);
  assert.throws(() => prepareNativeRequest(operations.get('thread/inject_items'), { 'params:threadId': threadId, 'params:items': '[]' }), error => error.fieldKey === 'params:items');
});

async function broker(run) {
  const f = await nativeStoredThreadFixture({ real: true, allowAgent: true, allowThreadsWrite: true, allowThreadShell: true }), v = await nativeVaultFixture(f);
  try {
    const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection);
    const connection = await v.session.enableNativeWorkflow(nativeReference(paired), selections), reference = nativeReference(connection);
    const execute = (method, params, progress) => v.session.executeNativeRuntime(reference, selections, selections.find(s => s.operation.rpc.method === method), params, undefined, progress);
    const threadId = (await execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
    await run({ f, v, selections, connection, execute, threadId });
  } finally { v.session.lock(); await f.close(); }
}
Then('the content broker stores typed data and preserves its loaded thread after revert', { timeout: 60000 }, async function () {
  await broker(async ({ f, v, connection, execute, threadId }) => {
    const goal = await execute('thread/goal/set', { threadId, objective: 'Owned broker goal\nwith explicit provenance', status: 'paused', origin: 'user' });
    assert.equal(goal.response.result.goal.status, 'paused');
    const attachment = { threadId, attachmentType: 'owned-broker', identityKey: 'item', payload: { values: [null, false, 7, 'Owned payload'] } };
    const created = await execute('thread/attachment/add', attachment); assert.equal(created.response.result.outcome, 'created');
    await execute('thread/attachment/remove', { threadId, attachmentType: attachment.attachmentType, identityKey: attachment.identityKey });
    const before = f.frames.filter(frame => frame.method === 'thread/attachment/add').length;
    await assert.rejects(execute('thread/attachment/add', { ...attachment, payload: { value: Buffer.from(f.key, 'utf16le').toString('base64') } }), error => error.code === 'REDACTED');
    assert.equal(f.frames.filter(frame => frame.method === 'thread/attachment/add').length, before);
    await execute('thread/inject_items', { threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'OWNED_BROKER_CONTENT_HISTORY' }] }] });
    const notices = [], pending = execute('thread/shellCommand', { threadId, command: 'printf OWNED_BROKER_CONTENT_TURN' }, notice => notices.push(notice)); void pending.catch(() => {});
    await waitForWatch(() => notices.some(notice => notice.kind === 'shell-approval'));
    await v.session.replyNativeRuntime(connection.id, notices.find(notice => notice.kind === 'shell-approval').token, 'accept');
    const completed = await pending, turnId = completed.response.result.completion.params.turn.id;
    const reverted = await execute('thread/revert', { threadId, beforeTurnId: turnId }); assert.equal(reverted.response.result.thread.id, threadId);
    assert.deepEqual(reverted.response.result.thread.turns, []);
    const read = await execute('thread/read', { threadId }); assert.equal(read.response.result.thread.id, threadId);
    assert.equal((await execute('thread/goal/clear', { threadId, origin: 'user' })).response.result.cleared, true);
    await execute('thread/metadata/update', { threadId, gitInfo: { branch: 'after-content-revert' } });
    assert.ok(nativeThreadContentMethods.every(method => f.frames.some(frame => frame.method === method))); assert.ok(f.provider.requests.every(path => path === '/v1/models'));
  });
});
Then('an explicitly active goal starts and clears through the real paired child without exposing its background turn', { timeout: 45000 }, async function () {
  await broker(async ({ f, execute, threadId }) => {
    await execute('thread/goal/set', { threadId, objective: 'Owned paused setup', status: 'paused', origin: 'user' });
    const active = await execute('thread/goal/set', { threadId, objective: 'Owned active goal lifecycle probe', status: 'active', tokenBudget: 1, origin: 'user' });
    assert.equal(active.response.result.goal.status, 'active');
    await waitForWatch(() => f.nativeEvents?.some(event => event.method === 'turn/started' && event.threadId === threadId));
    const cleared = await execute('thread/goal/clear', { threadId, origin: 'user' }); assert.equal(cleared.response.result.cleared, true);
    assert.equal((await execute('thread/goal/get', { threadId })).response.result.goal, null);
    assert.ok(f.provider.requests.every(path => ['/v1/models', '/v1/responses'].includes(path)));
  });
});
Then('content authority separates storage mutations from execution and owns autonomous goal turns', async function () {
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const threadId = randomUUID(), foreign = randomUUID(), turnId = randomUUID(), threads = new Map(), sent = [], writes = [];
  let prepares = 0;
  const settings = { identity, authority: async () => ({ ...identity }), threads, send: frame => sent.push(frame), write: frame => writes.push(frame),
    async prepareThreadContent(method, input) { prepares++; return { method, input, params: structuredClone(input), ids: [input.threadId] }; },
    reviewThreadContent: async (_plan, value) => value, inspectThreadGoal: async () => ({ goal: null }) };
  const denied = createCodexAgentSession({ ...settings, allowThreadsWrite: false });
  await assert.rejects(denied.request({ id: 'deny', method: 'thread/attachment/remove', params: { threadId, attachmentType: 'owned', identityKey: 'item' } })); assert.equal(prepares, 0); denied.close();
  const storage = createCodexAgentSession({ ...settings, allowAgent: false, allowThreadsWrite: true });
  await storage.request({ id: 'clear', method: 'thread/goal/clear', params: { threadId, origin: 'automatic' } }); await storage.receive({ id: 'clear', result: { cleared: false } });
  for (const method of ['thread/goal/set', 'thread/inject_items', 'thread/revert']) await assert.rejects(storage.request({ id: 'denyAgent', method,
    params: { threadId, ...(method === 'thread/inject_items' ? { items: [{}] } : method === 'thread/revert' ? { beforeTurnId: 'owned' } : {}) } }));
  assert.equal(threads.size, 0); storage.close();
  const agent = createCodexAgentSession({ ...settings, allowThreadsWrite: true });
  await agent.request({ id: 'start', method: 'thread/start', params: {} }); await agent.receive({ id: 'start', result: { thread: { id: threadId } } });
  await assert.rejects(agent.request({ id: 'foreign', method: 'thread/goal/set', params: { threadId: foreign, status: 'active', origin: 'user' } }));
  const input = { threadId, objective: 'Owned goal', status: 'active', origin: 'automatic' };
  assert.deepEqual((await agent.request({ id: 'goal', method: 'thread/goal/set', params: input })).params, input);
  await agent.receive({ id: 'goal', result: { goal: { threadId, status: 'active', objective: 'Owned goal' } } });
  await agent.receive({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
  await agent.receive({ id: 'backgroundApproval', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'owned', command: 'private command data' } });
  assert.ok(writes.some(frame => frame.id === 'backgroundApproval' && frame.error)); assert.equal(JSON.stringify(sent).includes('private command data'), false);
  assert.equal(sent.some(frame => frame.method === 'turn/started'), false);
  await assert.rejects(agent.request({ id: 'busy', method: 'turn/start', params: { threadId, input: [{ type: 'text', text: 'Wait for the goal' }] } }));
  await assert.rejects(agent.request({ id: 'busyLogin', method: 'account/login/start', params: { type: 'chatgpt' } }));
  await agent.request({ id: 'clearGoal', method: 'thread/goal/clear', params: { threadId, origin: 'user' } }); await agent.receive({ id: 'clearGoal', result: { cleared: true } });
  await agent.receive({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed' } } });
  await assert.rejects(agent.receive({ method: 'turn/started', params: { threadId, turn: { id: randomUUID() } } }));
  await agent.request({ id: 'revert', method: 'thread/revert', params: { threadId, beforeTurnId: 'owned' } }); await agent.receive({ id: 'revert', error: { code: -1, message: 'private native path' } });
  await assert.rejects(agent.request({ id: 'stale', method: 'turn/start', params: { threadId, input: [{ type: 'text', text: 'Stale' }] } }));
  await agent.request({ id: 'resume', method: 'thread/resume', params: { threadId } }); await agent.receive({ id: 'resume', result: { thread: { id: threadId } } }); agent.close();
});

Then('thread content inputs preserve payloads history items nullable budgets and goal origins', function () {
  const threadId = randomUUID();
  for (const payload of [null, 0, false, 'Owned\ntext', [], { nested: [{ fixture: true }] }])
    assert.deepEqual(nativeThreadContentParams('thread/attachment/add', { threadId, attachmentType: 'owned', identityKey: 'item', payload }).payload, payload);
  for (const origin of [undefined, null, 'automatic', 'user']) {
    const input = { threadId, objective: 'Owned goal', status: 'paused', tokenBudget: null, ...(origin === undefined ? {} : { origin }) };
    assert.deepEqual(nativeThreadContentParams('thread/goal/set', input), input);
  }
  for (const status of ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']) assert.equal(nativeThreadContentParams('thread/goal/set', { threadId, status }).status, status);
  const items = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Owned history' }] }, { type: 'function_call_output', call_id: 'owned-call', output: '{"fixture":true}' }];
  assert.deepEqual(nativeThreadContentParams('thread/inject_items', { threadId, items }).items, items);
  assert.deepEqual(nativeThreadContentParams('thread/revert', { threadId, beforeTurnId: 'owned-turn' }), { threadId, beforeTurnId: 'owned-turn' });
});
Then('thread content inputs reject unsafe shapes excessive values and authority overrides', function () {
  const threadId = randomUUID(), add = payload => ({ threadId, attachmentType: 'owned', identityKey: 'item', payload });
  for (const [method, input, field] of [
    ['thread/attachment/add', { threadId, attachmentType: 'owned', identityKey: 'item' }, 'payload'],
    ['thread/attachment/add', add({ value: Infinity }), 'payload'], ['thread/attachment/add', add(new Date()), 'payload'],
    ['thread/attachment/add', add('x'.repeat(32768)), 'payload'], ['thread/inject_items', { threadId, items: [] }, 'items'],
    ['thread/inject_items', { threadId, items: Array(17).fill({ type: 'message' }) }, 'items'],
    ['thread/goal/set', { threadId, status: 'invented' }, 'status'], ['thread/goal/set', { threadId, tokenBudget: -1 }, 'tokenBudget'],
    ['thread/revert', { threadId, beforeTurnId: ' ' }, 'beforeTurnId']
  ]) assert.throws(() => nativeThreadContentParams(method, input), error => error.field === field);
  for (const field of ['cwd', 'permissions', 'approvalPolicy', 'modelProvider']) assert.throws(() => nativeThreadContentParams('thread/goal/set', { threadId, [field]: 'override' }));
  const sparse = Array(1); assert.throws(() => nativeThreadContentParams('thread/attachment/add', add(sparse)), error => error.field === 'payload');
  let reads = 0; const payload = {}; Object.defineProperty(payload, 'value', { enumerable: true, get() { reads++; return 'private'; } });
  assert.throws(() => nativeThreadContentParams('thread/attachment/add', add(payload))); assert.equal(reads, 0);
});
Then('the pinned SDK stores attachments preserves goal provenance and reverts only conversation history', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture();
  try {
    const source = await readServiceSchema('codex'), call = f.call;
    f.call = async (method, params) => { const result = await call(method, params); if (isNativeThreadContentMethod(method)) validateNativeQueryResult(result, nativeThreadContentResultSchema(method, source), source, true); return result; };
    const seed = await f.seed(), threadId = seed.threadId;
    const attachment = { threadId, attachmentType: 'owned-content', identityKey: 'item', payload: { nested: [null, false, 7, 'Owned text'] } };
    const created = await f.call('thread/attachment/add', attachment); assert.equal(created.outcome, 'created');
    const existing = await f.call('thread/attachment/add', { ...attachment, payload: 'replacement is ignored' }); assert.equal(existing.outcome, 'existing'); assert.deepEqual(existing.attachment, created.attachment);
    await f.call('thread/attachment/remove', attachment); await f.call('thread/attachment/remove', attachment);
    assert.equal((await f.call('thread/attachment/list', { threadId, limit: 8 })).data.some(row => row.id === created.attachment.id), false);
    assert.equal((await f.call('thread/goal/clear', { threadId, origin: 'user' })).cleared, true);
    assert.equal((await f.call('thread/goal/clear', { threadId, origin: 'automatic' })).cleared, false);
    let goal = (await f.call('thread/goal/set', { threadId, objective: 'Owned content goal', status: 'paused', tokenBudget: 10000, origin: 'user' })).goal;
    assert.equal(goal.tokenBudget, 10000); assert.equal(goal.status, 'paused');
    goal = (await f.call('thread/goal/set', { threadId, tokenBudget: null, origin: 'automatic' })).goal; assert.equal(goal.tokenBudget, null); assert.equal(goal.status, 'paused');
    await f.call('thread/inject_items', { threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'OWNED_CONTENT_INJECTION' }] }] });
    const terminal = f.notification('turn/completed', p => p.threadId === threadId && p.turn.id !== seed.turn.id);
    await f.call('thread/shellCommand', { threadId, command: 'printf OWNED_CONTENT_SECOND_TURN' }); const turn = (await terminal).turn;
    await writeFile(join(f.workspace, 'revert-sentinel.txt'), 'Files survive conversation revert.');
    const before = await f.call('thread/turns/list', { threadId, limit: 8 }); assert.ok(before.data.some(row => row.id === turn.id));
    const reverted = await f.call('thread/revert', { threadId, beforeTurnId: turn.id }); assert.equal(reverted.thread.id, threadId); assert.deepEqual(reverted.thread.turns, []);
    const after = await f.call('thread/turns/list', { threadId, limit: 8 }); assert.equal(after.data.some(row => row.id === turn.id), false);
    assert.equal(await readFile(join(f.workspace, 'revert-sentinel.txt'), 'utf8'), 'Files survive conversation revert.');
    assert.ok(nativeThreadContentMethods.every(method => f.calls.some(call => call.method === method))); assert.ok(f.provider.requests.every(path => path === '/v1/models'));
  } finally { await f.close(); }
});
