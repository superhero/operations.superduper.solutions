// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeTurnControlParams, nativeTurnControlResult } from './lib/native-turn-control.ts';
import { nativeTurnControlFixture } from '../tests/native-turn-control.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { canStartVaultRequest } from './lib/secrets/request-policy.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';

const steer = { threadId: 'thread_owned', expectedTurnId: 'turn_owned', input: [{ type: 'text', text: 'AéB', text_elements: [{ byteRange: { start: 1, end: 3 }, placeholder: 'é' }] }], clientUserMessageId: null };
Before({ tags: '@native-turn-control' }, function () { this.turnControlFixtures = []; });
After({ tags: '@native-turn-control' }, async function () { for (const c of this.turnControlFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeTurnControlFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.turnControlFixtures.push(c);
  c.selections = await v.workflowSelections(); const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  c.connection = await v.session.enableNativeWorkflow(nativeReference(paired), c.selections); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params, signal, progress) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, signal, progress);
  c.control = (method, params, signal) => v.session.controlNativeTurn(c.reference, c.selections, c.select(method), params, signal);
  c.threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  return c;
}
async function start(c) {
  let running, failure;
  const promise = c.execute('turn/start', { threadId: c.threadId, input: [{ type: 'text', text: 'Owned first instruction.' }] }, undefined, note => { if (note.kind === 'running') running = note; });
  void promise.catch(error => { failure = error; });
  await waitForWatch(() => running || failure); assert.ifError(failure); return { promise, running };
}
Then('turn control inputs retain native IDs annotations and client message IDs', function () {
  assert.deepEqual(nativeTurnControlParams('turn/steer', steer), steer);
  assert.deepEqual(nativeTurnControlParams('turn/interrupt', { threadId: 'thread_owned', turnId: '' }), { threadId: 'thread_owned', turnId: '' });
  for (const clientUserMessageId of [undefined, null, '', 'opaque-message']) {
    const params = { ...steer }; if (clientUserMessageId === undefined) delete params.clientUserMessageId; else params.clientUserMessageId = clientUserMessageId;
    assert.deepEqual(nativeTurnControlParams('turn/steer', params), params);
  }
  assert.deepEqual(nativeTurnControlResult('turn/steer', { turnId: 'turn_owned' }, steer), { turnId: 'turn_owned' });
});
Then('invalid turn controls name their offending parameters before dispatch', function () {
  for (const [method, params, field] of [['turn/interrupt', { threadId: 'thread_owned' }, 'turnId'], ['turn/steer', { ...steer, expectedTurnId: '' }, 'expectedTurnId'],
    ['turn/steer', { ...steer, input: [] }, 'input'], ['turn/steer', { ...steer, input: [{ type: 'text', text: 'é', text_elements: [{ byteRange: { start: 1, end: 2 } }] }] }, 'input'],
    ['turn/steer', { ...steer, approvalPolicy: 'never' }, 'approvalPolicy']]) assert.throws(() => nativeTurnControlParams(method, params), error => error.field === field);
});
Then('owned steering retains its acknowledgement without completing the parent turn', async function () {
  const c = await setup(this), work = await start(c); let finished = false; void work.promise.then(() => { finished = true; });
  const params = { ...steer, threadId: c.threadId, expectedTurnId: work.running.turnId };
  const result = await c.control('turn/steer', params); assert.deepEqual(result.response.result, { turnId: work.running.turnId }); assert.equal(finished, false);
  assert.deepEqual(c.f.steered, params); c.f.completeTurn(); await work.promise;
});
Then('owned interruption drains native acknowledgements before the parent closes', async function () {
  assert.equal(canStartVaultRequest(['executeNativeRuntime'], 'controlNativeTurn'), true);
  assert.equal(canStartVaultRequest(['executeNativeRuntime', 'controlNativeTurn'], 'controlNativeTurn'), false);
  for (const ackFirst of [true, false]) {
    const c = await setup(this, { ackFirst }), work = await start(c);
    const result = await c.control('turn/interrupt', { threadId: c.threadId, turnId: work.running.turnId }); assert.deepEqual(result.response.result, {});
    await assert.rejects(work.promise, error => error.code === 'CANCELLED'); assert.equal(c.f.interrupts, 1);
  }
});
Then('startup interruption cancels only the owned pending thread', async function () {
  const c = await setup(this, { holdStartup: true });
  const promise = c.execute('turn/start', { threadId: c.threadId, input: [{ type: 'text', text: 'Owned startup.' }] }); void promise.catch(() => {});
  await waitForWatch(() => c.f.startupFrame); assert.deepEqual((await c.control('turn/interrupt', { threadId: c.threadId, turnId: '' })).response.result, {}); await assert.rejects(promise);
});
Then('turn controls reject unowned preconditions while preserving their owner', async function () {
  const c = await setup(this); await assert.rejects(c.control('turn/interrupt', { threadId: c.threadId, turnId: 'foreign' }), error => error.code === 'PERMISSION');
  const work = await start(c);
  for (const params of [{ ...steer, threadId: 'foreign', expectedTurnId: work.running.turnId }, { ...steer, threadId: c.threadId }])
    await assert.rejects(c.control('turn/steer', params), error => error.code === 'PERMISSION');
  assert.equal(c.f.frames.some(f => f.method === 'turn/steer'), false); c.f.completeTurn(); await work.promise;
});
Then('turn controls lose revoked authority and reject mismatched replies', async function () {
  const c = await setup(this), work = await start(c); c.v.enabled = false;
  await assert.rejects(c.control('turn/steer', { ...steer, threadId: c.threadId, expectedTurnId: work.running.turnId })); c.v.enabled = true; c.f.completeTurn(); await work.promise;
  const other = await setup(this), pending = await start(other); other.f.wrongSteerAck = true;
  await assert.rejects(other.control('turn/steer', { ...steer, threadId: other.threadId, expectedTurnId: pending.running.turnId })); await assert.rejects(pending.promise);
});
Then('turn control operation models preserve typed native contracts', async function () {
  const source = await readServiceSchema('codex');
  for (const method of ['turn/steer', 'turn/interrupt']) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.deepEqual(scopeNativeRpcSchema(document, method), document);
    assert.equal(document['x-operations-native-workflow'].wireNotifications.length, 2);
    const values = method === 'turn/steer' ? { 'params:threadId': 'thread_owned', 'params:expectedTurnId': 'turn_owned', 'params:input': '[{"type":"text","text":"Owned"}]' } : { 'params:threadId': 'thread_owned', 'params:turnId': '' };
    assert.equal(prepareNativeRequest(operation, values).method, method);
  }
});
Then('the actual SDK steering preserves its owner and queued instruction', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true }), work = await start(c);
  await waitForWatch(() => c.f.provider.pending.length === 1);
  assert.deepEqual((await c.control('turn/steer', { threadId: c.threadId, expectedTurnId: work.running.turnId, input: [{ type: 'text', text: 'Owned steered instruction.' }], clientUserMessageId: 'owned-steer-message' })).response.result, { turnId: work.running.turnId });
  c.f.provider.pending[0].finish(); await waitForWatch(() => c.f.provider.pending.length === 2);
  assert.ok(JSON.stringify(c.f.provider.pending[1].body).includes('Owned steered instruction.')); c.f.provider.pending[1].finish(); await work.promise;
});
Then('the actual SDK interruption completes through the private workflow broker', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true }), work = await start(c); await waitForWatch(() => c.f.provider.pending.length === 1);
  assert.deepEqual((await c.control('turn/interrupt', { threadId: c.threadId, turnId: work.running.turnId })).response.result, {});
  await assert.rejects(work.promise, error => error.code === 'CANCELLED');
});
