// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeTurnWorkParams, nativeTurnWorkAcknowledgement } from './lib/native-turn-work.ts';
import { nativeTurnWorkFixture } from '../tests/native-turn-work.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeStoredThreadSdkFixture } from '../tests/native-stored-thread-sdk.fixture.mjs';
import { seedNativeTurnProvider } from '../tests/native-turn-control.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

const reviewAnswer = JSON.stringify({ findings: [], overall_correctness: 'patch is correct', overall_explanation: 'Owned fixture review.', overall_confidence_score: 1 });
async function rawThread(f) {
  return (await f.call('thread/start', { model: 'owned-fixture-model', approvalPolicy: 'on-request', approvalsReviewer: 'user' })).thread.id;
}
Then('the actual SDK rejects detached review on paginated threads', { timeout: 45000 }, async function () {
  const f = await nativeStoredThreadSdkFixture({ providerFactory: seedNativeTurnProvider });
  try {
    const threadId = await rawThread(f);
    await assert.rejects(f.call('review/start', { threadId, delivery: 'detached', target: { type: 'custom', instructions: 'Owned review.' } }), /paginated threads do not support detached review/);
    assert.equal(f.provider.pending.length, 0);
  } finally { await f.close(); }
});

Before({ tags: '@native-turn-work' }, function () { this.turnWorkFixtures = []; });
After({ tags: '@native-turn-work' }, async function () { for (const c of this.turnWorkFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeTurnWorkFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.turnWorkFixtures.push(c);
  c.selections = await v.workflowSelections(); const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  c.connection = await v.session.enableNativeWorkflow(nativeReference(paired), c.selections); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params, progress) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, undefined, progress);
  c.control = (method, params) => v.session.controlNativeTurn(c.reference, c.selections, c.select(method), params);
  c.threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  return c;
}
const workParams = (c, method) => ({ threadId: c.threadId, ...(method === 'review/start' ? { target: { type: 'custom', instructions: 'Owned review.' } } : {}) });
const targets = [{ type: 'uncommittedChanges' }, { type: 'baseBranch', branch: 'owned-main' }, { type: 'commit', sha: 'HEAD', title: null }, { type: 'custom', instructions: 'Owned review.' }];
Then('native turn work validates all review targets and identifies invalid fields', function () {
  for (const target of targets) for (const delivery of [undefined, null, 'inline']) {
    const params = { threadId: 'thread_owned', target, ...(delivery === undefined ? {} : { delivery }) };
    assert.deepEqual(nativeTurnWorkParams('review/start', params), params);
  }
  for (const [input, field] of [[{ target: { type: 'baseBranch' } }, 'target.branch'], [{ target: { type: 'commit', sha: '--unsafe' } }, 'target.sha'],
    [{ target: { type: 'uncommittedChanges', instructions: 'Wrong variant' } }, 'target.instructions'], [{ delivery: 'detached' }, 'delivery'], [{ cwd: '/' }, 'cwd']])
    assert.throws(() => nativeTurnWorkParams('review/start', { threadId: 'thread_owned', target: targets[3], ...input }), e => e.field === field);
  assert.throws(() => nativeTurnWorkAcknowledgement('review/start', { reviewThreadId: 'foreign', turn: { id: 'turn_owned', status: 'inProgress', items: [] } }, 'thread_owned'));
});
Then('native turn work models preserve acknowledgements and terminal notifications', async function () {
  const source = await readServiceSchema('codex');
  for (const method of ['review/start', 'thread/compact/start']) {
    const doc = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(doc, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.deepEqual(scopeNativeRpcSchema(doc, method), doc);
    assert.equal(doc['x-operations-native-workflow'].wireNotifications.length, 2);
    const values = { 'params:threadId': 'thread_owned', ...(method === 'review/start' ? { 'params:target': JSON.stringify(targets[3]), 'params:delivery': 'inline' } : {}) };
    assert.equal(prepareNativeRequest(operation, values).method, method);
    if (method === 'review/start') assert.deepEqual(operation.fields.find(f => f.name === 'delivery').enum, ['inline']);
  }
});
Then('owned native work {string} waits for its terminal turn', async function (method) {
  const c = await setup(this); let finished = false;
  const promise = c.execute(method, workParams(c, method)); void promise.catch(() => {}); void promise.then(() => { finished = true; }, () => {});
  await waitForWatch(() => c.f.workStarted); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(finished, false);
  c.f.finishWork(); const result = (await promise).response.result;
  if (method === 'review/start') { assert.equal(result.reviewThreadId, c.threadId); assert.equal(result.turn.status, 'completed'); }
  else assert.deepEqual(result, {});
});
Then('early native work {string} completes only after its acknowledgement', async function (method) {
  const c = await setup(this, { holdAck: true, terminalFirst: true }); let finished = false;
  const promise = c.execute(method, workParams(c, method)); void promise.catch(() => {}); void promise.then(() => { finished = true; }, () => {});
  await waitForWatch(() => c.f.workStarted); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(finished, false);
  c.f.ackWork(); await promise;
});
Then('native turn work rejects foreign owners without exposing results', async function () {
  const c = await setup(this);
  await assert.rejects(c.execute('thread/compact/start', { threadId: 'foreign' })); assert.equal(c.f.workStarted, undefined);
  const other = await setup(this, { foreignAck: true });
  await assert.rejects(other.execute('review/start', workParams(other, 'review/start')));
});
Then('native turn work supports interruption and rejects steering', async function () {
  for (const method of ['review/start', 'thread/compact/start']) {
    const c = await setup(this); let running;
    const promise = c.execute(method, workParams(c, method), p => { if (p.kind === 'running') running = p; }); void promise.catch(() => {});
    await waitForWatch(() => running);
    await assert.rejects(c.control('turn/steer', { threadId: c.threadId, expectedTurnId: running.turnId, input: [{ type: 'text', text: 'Wrong work kind.' }] }), e => e.code === 'PERMISSION');
    assert.deepEqual((await c.control('turn/interrupt', { threadId: c.threadId, turnId: running.turnId })).response.result, {});
    await assert.rejects(promise, e => e.code === 'CANCELLED');
  }
});
Then('native turn work withholds revoked and credential-bearing results', async function () {
  const c = await setup(this), promise = c.execute('review/start', workParams(c, 'review/start')); void promise.catch(() => {});
  await waitForWatch(() => c.f.workStarted); c.v.enabled = false; c.f.finishWork(); await assert.rejects(promise);
  const other = await setup(this), echo = other.execute('review/start', workParams(other, 'review/start')); void echo.catch(() => {});
  await waitForWatch(() => other.f.workStarted); other.f.terminalText = other.f.key; other.f.finishWork(); await assert.rejects(echo);
});
async function seedGit(workspace) {
  const git = (...args) => promisify(execFile)('git', ['-C', workspace, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Owned fixture', '-c', 'user.email=fixture@example.invalid', ...args], { timeout: 10000, maxBuffer: 8192 });
  await git('init', '-b', 'owned-main'); await writeFile(join(workspace, 'owned.txt'), 'Owned review fixture.\n'); await git('add', 'owned.txt'); await git('commit', '-m', 'Owned fixture base');
  await writeFile(join(workspace, 'owned.txt'), 'Owned review fixture with an uncommitted change.\n');
}
Then('the actual SDK workflow reviews the {string} target on its owned thread', { timeout: 45000 }, async function (type) {
  const c = await setup(this, { real: true }); await seedGit(c.f.workspace);
  const target = targets.find(t => t.type === type), before = c.f.provider.pending.length; let finished = false;
  let failure;
  const promise = c.execute('review/start', { threadId: c.threadId, target }); void promise.catch(error => { failure = error; }); void promise.then(() => { finished = true; }, () => {});
  await waitForWatch(() => c.f.provider.pending.length > before || failure);
  if (failure) assert.fail('Owned review failed: ' + failure.code + '; native: ' + (c.f.nativeWorkError ?? 'no native error') + '; trace: ' + JSON.stringify(c.f.nativeWorkTrace));
  assert.equal(finished, false); c.f.provider.pending[before].finish(reviewAnswer);
  const result = (await promise).response.result; assert.equal(result.reviewThreadId, c.threadId); assert.equal(result.turn.status, 'completed');
});
Then('the actual SDK compaction workflow waits for its owned terminal event', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true });
  const first = c.execute('turn/start', { threadId: c.threadId, input: [{ type: 'text', text: 'Owned history for compaction.' }] }); void first.catch(() => {});
  await waitForWatch(() => c.f.provider.pending.length === 1); c.f.provider.pending[0].finish(); await first;
  let finished = false; const promise = c.execute('thread/compact/start', { threadId: c.threadId }); void promise.catch(() => {}); void promise.then(() => { finished = true; }, () => {});
  await waitForWatch(() => c.f.provider.pending.length === 2); assert.equal(finished, false); c.f.provider.pending[1].finish('Owned compacted history.');
  assert.deepEqual((await promise).response.result, {});
});
Then('review delegate starts preserve the acknowledged parent in both event orders', async function () {
  for (const ackFirst of [true, false]) {
    const c = await setup(this, { delegateStart: true, ackFirst }); let running;
    const promise = c.execute('review/start', workParams(c, 'review/start'), p => { if (p.kind === 'running') running = p; }); void promise.catch(() => {});
    await waitForWatch(() => running); assert.equal(running.turnId, 'owned_review_delegate');
    c.f.finishWork(); const result = (await promise).response.result; assert.equal(result.turn.id, c.f.workTurnId); assert.notEqual(result.turn.id, running.turnId);
    const previous = c.f.workStarted;
    const foreign = c.execute('review/start', workParams(c, 'review/start')); void foreign.catch(() => {});
    await waitForWatch(() => c.f.workStarted !== previous); c.f.finishWork('completed', { id: 'foreign_turn' }); await assert.rejects(foreign);
  }
});
Then('the actual SDK inline review retains owned interruption', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true }); let running, failure;
  const promise = c.execute('review/start', workParams(c, 'review/start'), p => { if (p.kind === 'running') running = p; }); void promise.catch(error => { failure = error; });
  await waitForWatch(() => failure || running && c.f.provider.pending.length > 0); assert.ifError(failure);
  try { assert.deepEqual((await c.control('turn/interrupt', { threadId: c.threadId, turnId: running.turnId })).response.result, {}); }
  catch (error) { assert.fail('Owned review interruption failed: ' + error.code + '; native: ' + (c.f.nativeWorkError ?? 'no native error')); }
  await assert.rejects(promise, e => e.code === 'CANCELLED');
});
