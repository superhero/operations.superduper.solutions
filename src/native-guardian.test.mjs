// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { pathToFileURL } from 'node:url';
import { nativeGuardianFixture, guardianFixtureNotice } from '../tests/native-guardian.fixture.mjs';
import { nativeGuardianMethod, nativeGuardianParams, nativeGuardianEvent, NativeGuardianReviews } from './lib/native-guardian.ts';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { nativeWorkflowParams } from './lib/native-agent-contract.ts';
import { nativeTurnControlParams } from './lib/native-turn-control.ts';
import { nativeTurnWorkParams } from './lib/native-turn-work.ts';
import { nativeStoredThreadReadParams } from './lib/native-stored-thread.ts';
import { nativeStoredThreadSdkFixture } from '../tests/native-stored-thread-sdk.fixture.mjs';
import { seedNativeTurnProvider } from '../tests/native-turn-control.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

Then('the actual SDK guardian denial can be approved using only its observed native action', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture({ providerFactory: seedNativeTurnProvider });
  try {
    const threadId = (await f.call('thread/start', { model: 'owned-fixture-model', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' })).thread.id;
    const result = await f.call('turn/start', { threadId, input: [{ type: 'text', text: 'Exercise an owned approval fixture, then stop.' }] });
    await waitForWatch(() => f.provider.pending.length === 1);
    const tools = f.provider.pending[0].body.tools.map(tool => tool.name ?? tool.type);
    assert.ok(tools.includes('exec_command'), 'Owned provider tool names: ' + tools.join(','));
    f.provider.pending[0].finishTool('exec_command', { cmd: 'printf OWNED_GUARDIAN_DENIAL', sandbox_permissions: 'require_escalated', justification: 'Owned fixture approval exercise.' });
    await waitForWatch(() => f.provider.pending.length === 2, 'The native reviewer did not reach the owned response provider.');
    f.provider.pending[1].finish(JSON.stringify({ outcome: 'deny', risk_level: 'high', user_authorization: 'low', rationale: 'Owned fixture denies this harmless command to exercise approval provenance.' }));
    const denial = await f.notification('item/autoApprovalReview/completed', p => p.threadId === threadId && p.review?.status === 'denied');
    assert.equal(denial.turnId, result.turn.id); assert.equal(denial.action.type, 'command'); assert.match(denial.action.command, /OWNED_GUARDIAN_DENIAL/);
    const event = { id: denial.reviewId, target_item_id: denial.targetItemId, turn_id: denial.turnId,
      started_at_ms: denial.startedAtMs, completed_at_ms: denial.completedAtMs, status: 'denied', risk_level: denial.review.riskLevel,
      user_authorization: denial.review.userAuthorization, rationale: denial.review.rationale, decision_source: denial.decisionSource,
      action: { type: 'command', source: denial.action.source === 'unifiedExec' ? 'unified_exec' : denial.action.source, command: denial.action.command, cwd: denial.action.cwd } };
    assert.deepEqual(await f.call('thread/approveGuardianDeniedAction', { threadId, event }), {});
    await waitForWatch(() => f.provider.pending.length === 3); f.provider.pending[2].finish('Owned denial was recorded.');
    await f.notification('turn/completed', p => p.threadId === threadId && p.turn.id === result.turn.id);
    const next = await f.call('turn/start', { threadId, input: [{ type: 'text', text: 'Report the owned approved action context without running a tool.' }] });
    await waitForWatch(() => f.provider.pending.length === 4);
    const strings = []; const collect = value => { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(collect); }; collect(f.provider.pending[3].body.input);
    const context = strings.join('\n'); assert.ok(context.includes('"outcome": "allowed"')); assert.ok(context.includes('OWNED_GUARDIAN_DENIAL'));
    f.provider.pending[3].finish('Owned approved action context observed.');
    await f.notification('turn/completed', p => p.threadId === threadId && p.turn.id === next.turn.id);
  } finally { await f.close(); }
});

Before({ tags: '@native-guardian' }, function () { this.guardianFixtures = []; });
After({ tags: '@native-guardian' }, async function () { for (const c of this.guardianFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeGuardianFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.guardianFixtures.push(c);
  c.selections = await v.workflowSelections(); const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  c.connection = await v.session.enableNativeWorkflow(nativeReference(paired), c.selections); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params, signal, progress) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, signal, progress);
  if (!options.noThread) c.threadId = (await c.execute('thread/start', { model: 'owned-fixture-model', approvalsReviewer: 'auto_review' })).response.result.thread.id;
  return c;
}
async function denied(c) {
  const notices = []; let failure;
  const promise = c.execute('turn/start', { threadId: c.threadId, input: [{ type: 'text', text: 'Exercise an owned approval fixture, then stop.' }] }, undefined, note => notices.push(note));
  void promise.catch(error => { failure = error; });
  if (c.f.provider) {
    await waitForWatch(() => failure || c.f.provider.pending.length === 1); assert.ifError(failure);
    c.f.provider.pending[0].finishTool('exec_command', { cmd: 'printf OWNED_GUARDIAN_DENIAL', sandbox_permissions: 'require_escalated', justification: 'Owned fixture approval exercise.' });
    await waitForWatch(() => failure || c.f.provider.pending.length === 2); assert.ifError(failure);
    c.f.provider.pending[1].finish('{"outcome":"deny","risk_level":"high","user_authorization":"low","rationale":"Owned fixture denial."}');
  }
  await waitForWatch(() => failure || notices.some(n => n.kind === 'guardian-denial')); assert.ifError(failure);
  if (c.f.provider) { await waitForWatch(() => c.f.provider.pending.length === 3); c.f.provider.pending[2].finish('Owned denial recorded.'); }
  else c.f.completeTurn();
  await promise; return notices.find(n => n.kind === 'guardian-denial');
}
function approval(c, denial, signal) {
  const notices = [], promise = c.execute(nativeGuardianMethod, { threadId: c.threadId, reviewId: denial.reviewId }, signal, notice => notices.push(notice));
  void promise.catch(() => {}); return { notices, promise, signal };
}
async function confirm(c, work) {
  await waitForWatch(() => work.notices.some(n => n.kind === 'guardian-approval'));
  const notice = work.notices.find(n => n.kind === 'guardian-approval');
  await c.v.session.replyNativeRuntime(c.connection.id, notice.token, 'accept', work.signal); return notice;
}
Then('Guardian action conversion preserves all seven variants and rejects editable events', function () {
  const cwd = '/owned/workspace', actions = [
    { type: 'command', source: 'unifiedExec', command: 'printf OWNED', cwd }, { type: 'execve', source: 'shell', program: '/bin/echo', argv: ['echo', 'OWNED'], cwd },
    { type: 'writeStdin', approvalId: 'approval:owned', processId: 'process:owned', stdin: 'OWNED\n', cwd }, { type: 'applyPatch', cwd, files: [cwd + '/owned.txt'] },
    { type: 'networkAccess', target: 'owned', host: 'localhost', protocol: 'socks5Tcp', port: 1234 },
    { type: 'mcpToolCall', server: 'owned', toolName: 'tool', connectorId: null, connectorName: null, toolTitle: 'Owned tool' },
    { type: 'requestPermissions', reason: null, permissions: { network: { enabled: true }, fileSystem: { read: [cwd], write: [], globScanMaxDepth: 4 } } }
  ];
  const kinds = ['command', 'execve', 'write_stdin', 'apply_patch', 'network_access', 'mcp_tool_call', 'request_permissions'];
  for (const [index, action] of actions.entries()) {
    const store = new NativeGuardianReviews(), pair = guardianFixtureNotice(cwd); pair.started.action = pair.completed.action = action;
    store.started(pair.started, pair.started.threadId, pair.started.turnId); const denial = store.completed(pair.completed, pair.started.threadId, pair.started.turnId);
    const event = nativeGuardianEvent(denial, path => pathToFileURL(path).href); assert.equal(event.action.type, kinds[index]); assert.equal(event.id, denial.reviewId);
    if (action.type === 'writeStdin') { assert.equal(event.action.cwd, pathToFileURL(cwd).href); assert.equal(event.action.stdin, action.stdin); }
    if (action.type === 'requestPermissions') assert.deepEqual(event.action.permissions.file_system, { entries: [{ access: 'read', path: { type: 'path', path: pathToFileURL(cwd).href } }], glob_scan_max_depth: 4 });
  }
  assert.throws(() => nativeGuardianParams({ threadId: 'thread_owned', event: {} }), e => e.field === 'event');
});
Then('Guardian reviews reject foreign changed expired and replayed lifecycles', function () {
  let now = 1; const store = new NativeGuardianReviews(() => now), pair = guardianFixtureNotice('/owned');
  assert.throws(() => store.completed(pair.completed, 'thread_owned', 'turn_owned'));
  assert.throws(() => store.started(pair.started, 'foreign', 'turn_owned'));
  store.started(pair.started, 'thread_owned', 'turn_owned');
  assert.throws(() => store.completed({ ...pair.completed, action: { ...pair.completed.action, command: 'Changed' } }, 'thread_owned', 'turn_owned'));
  store.completed(pair.completed, 'thread_owned', 'turn_owned');
  assert.throws(() => store.get({ threadId: 'foreign', reviewId: pair.completed.reviewId }));
  store.consume({ threadId: 'thread_owned', reviewId: pair.completed.reviewId });
  assert.throws(() => store.started(pair.started, 'thread_owned', 'turn_owned')); assert.throws(() => store.get({ threadId: 'thread_owned', reviewId: pair.completed.reviewId }));
  const later = guardianFixtureNotice('/owned', 'thread_owned', 'turn_owned', 'later'); store.started(later.started, 'thread_owned', 'turn_owned'); store.completed(later.completed, 'thread_owned', 'turn_owned');
  now += 600001; assert.throws(() => store.get({ threadId: 'thread_owned', reviewId: 'later' }));
});
Then('AI approval review requires both an explicit thread choice and its host grant', async function () {
  for (const approvalsReviewer of [['auto_review'], { value: 'auto_review' }, null, true]) assert.throws(() => nativeWorkflowParams('thread/start', { approvalsReviewer }));
  const c = await setup(this, { noThread: true, allowGuardian: false });
  await c.execute('thread/start', { model: 'owned-fixture-model' }); assert.equal(c.f.frames.filter(f => f.method === 'thread/start').at(-1).params.approvalsReviewer, 'user');
  await assert.rejects(c.execute('thread/start', { approvalsReviewer: 'auto_review' }));
  assert.equal(c.f.frames.filter(f => f.method === 'thread/start').length, 1);
  const mismatch = await setup(this, { noThread: true, onFrame(frame, f, emit) {
    if (frame.method !== 'thread/start') return false;
    queueMicrotask(() => emit({ id: frame.id, result: { thread: { id: 'thread_mismatch' }, approvalsReviewer: 'auto_review' } })); return true;
  } });
  await assert.rejects(mismatch.execute('thread/start', {}));
});
Then('an observed Guardian denial dispatches only after one matching human approval', async function () {
  const c = await setup(this), denial = await denied(c), work = approval(c, denial);
  await waitForWatch(() => work.notices.length); assert.equal(c.f.approvedEvent, undefined);
  const notice = await confirm(c, work); assert.equal(notice.denial.reviewId, denial.reviewId); assert.deepEqual((await work.promise).response.result, {});
  assert.equal(c.f.approvedEvent.id, denial.reviewId); assert.equal(c.f.approvedEvent.action.command, 'printf OWNED_GUARDIAN_DENIAL');
  await assert.rejects(c.v.session.replyNativeRuntime(c.connection.id, notice.token, 'accept'));
  await assert.rejects(c.execute(nativeGuardianMethod, { threadId: c.threadId, reviewId: denial.reviewId }));
  assert.equal(c.f.frames.filter(f => f.method === nativeGuardianMethod).length, 1);
});
Then('declined cancelled or revoked Guardian approvals never dispatch', async function () {
  for (const mode of ['decline', 'cancel', 'revoke']) {
    const c = await setup(this), denial = await denied(c), controller = new AbortController(), work = approval(c, denial, controller.signal);
    await waitForWatch(() => work.notices.length); const token = work.notices[0].token;
    if (mode === 'decline') await c.v.session.replyNativeRuntime(c.connection.id, token, 'decline', controller.signal);
    else if (mode === 'cancel') controller.abort();
    else { c.v.enabled = false; await assert.rejects(c.v.session.replyNativeRuntime(c.connection.id, token, 'accept', controller.signal)); }
    await assert.rejects(work.promise); assert.equal(c.f.approvedEvent, undefined);
  }
});
Then('foreign and malformed Guardian denials remain unavailable', async function () {
  const c = await setup(this); await assert.rejects(c.execute(nativeGuardianMethod, { threadId: c.threadId, reviewId: 'foreign' })); assert.equal(c.f.approvedEvent, undefined);
  const other = await setup(this, { manualReview: true });
  const promise = other.execute('turn/start', { threadId: other.threadId, input: [{ type: 'text', text: 'Owned' }] }); void promise.catch(() => {});
  await waitForWatch(() => other.f.guardianNotices); other.f.startReview(); other.f.finishReview({ action: { ...other.f.guardianNotices.completed.action, command: 'Changed action' } });
  await assert.rejects(promise); assert.equal(other.f.approvedEvent, undefined);
});
Then('malformed Guardian acknowledgement withholds success without replay', async function () {
  const c = await setup(this), denial = await denied(c); c.f.wrongResult = true;
  const work = approval(c, denial); await confirm(c, work); await assert.rejects(work.promise);
  assert.equal(c.f.frames.filter(f => f.method === nativeGuardianMethod).length, 1);
});
Then('Guardian action credential echoes are withheld', async function () {
  const c = await setup(this, { manualReview: true }); const notices = [];
  const promise = c.execute('turn/start', { threadId: c.threadId, input: [{ type: 'text', text: 'Owned' }] }, undefined, p => notices.push(p)); void promise.catch(() => {});
  await waitForWatch(() => c.f.guardianNotices);
  c.f.guardianNotices.started.action.command = c.f.guardianNotices.completed.action.command = 'printf ' + c.f.key;
  c.f.startReview(); c.f.finishReview(); await assert.rejects(promise);
  assert.equal(notices.some(p => p.kind === 'guardian-denial'), false); assert.equal(c.f.approvedEvent, undefined);
});
Then('Guardian operation models retain native event and notification schemas', async function () {
  const source = await readServiceSchema('codex'), document = scopeNativeRpcSchema(source, nativeGuardianMethod), operation = nativeRpcOperation(document, 'codex:' + nativeGuardianMethod);
  assert.equal(operation.unavailableReason, undefined); assert.deepEqual(scopeNativeRpcSchema(document, nativeGuardianMethod), document);
  assert.equal(document['x-operations-native-workflow'].guardianNotifications.length, 2);
  assert.ok(JSON.stringify(document.definitions.ClientRequest).includes('ThreadApproveGuardianDeniedActionParams'));
  assert.equal(prepareNativeRequest(operation, { 'params:threadId': 'thread_owned', 'params:reviewId': 'review_owned' }).params.reviewId, 'review_owned');
  const startDoc = scopeNativeRpcSchema(source, 'thread/start'), start = nativeRpcOperation(startDoc, 'codex:thread/start'), field = start.fields.find(f => f.name === 'approvalsReviewer');
  assert.equal(field.label, 'Approval reviewer'); assert.deepEqual(field.enum, ['user', 'auto_review']); assert.equal(field.defaultValue, 'user');
});
Then('native multiline action text preserves content without widening identifier validation', function () {
  const input = { threadId: 'thread_owned', expectedTurnId: 'turn_owned', input: [{ type: 'text', text: 'Owned\nsteering\ttext.' }] };
  assert.deepEqual(nativeTurnControlParams('turn/steer', input), input);
  const review = { threadId: 'thread_owned', target: { type: 'custom', instructions: 'Owned\nreview\tinstructions.' } };
  assert.deepEqual(nativeTurnWorkParams('review/start', review), review);
  assert.throws(() => nativeStoredThreadReadParams('thread/read', { threadId: 'thread\nowned' }));
  assert.throws(() => nativeGuardianParams({ threadId: 'thread_owned', reviewId: 'review\nowned' }));
  assert.throws(() => nativeTurnControlParams('turn/steer', { ...input, input: [{ type: 'text', text: 'Owned\u0000invalid.' }] }));
});
Then('the actual SDK Guardian workflow records its action only after human confirmation', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true }), denial = await denied(c), work = approval(c, denial);
  await waitForWatch(() => work.notices.length); assert.equal(c.f.frames.filter(f => f.method === nativeGuardianMethod).length, 0);
  await confirm(c, work); assert.deepEqual((await work.promise).response.result, {});
  const next = c.execute('turn/start', { threadId: c.threadId, input: [{ type: 'text', text: 'Report the approved action without running a tool.' }] }); void next.catch(() => {});
  await waitForWatch(() => c.f.provider.pending.length === 4);
  const strings = []; const collect = v => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); }; collect(c.f.provider.pending[3].body.input);
  assert.ok(strings.join('\n').includes('"outcome": "allowed"')); c.f.provider.pending[3].finish('Owned action approval observed.'); await next;
});
