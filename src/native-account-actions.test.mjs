// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeAccountActionParams, nativeAccountActionResult, nativeAccountActionMethods } from './lib/native-account-actions.ts';
import { nativeAccountActionsFixture } from '../tests/native-account-actions.fixture.mjs';
import { nativeAccountSdkFixture } from '../tests/native-account-read-sdk.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { NativeAccountActionBroker } from './lib/secrets/native-account-actions.ts';
import { VaultError } from './lib/secrets/types.ts';
import { nativeAccountActionApprovalMethod } from './lib/native-account-actions.ts';

const reset = nativeAccountActionMethods[0], email = nativeAccountActionMethods[1];
const input = method => method === reset ? { idempotencyKey: 'owned logical reset / 42', creditId: 'owned credit +/?42' } : { creditType: 'usage_limit' };
const dispatches = c => c.f.frames.filter(frame => nativeAccountActionMethods.includes(frame.method));
Before({ tags: '@native-account-actions' }, function () { this.accountActionFixtures = []; });
After({ tags: '@native-account-actions' }, async function () { for (const c of this.accountActionFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeAccountActionsFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.accountActionFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.execute = (method, params = input(method), signal, progress) => v.session.executeNativeRuntime(c.reference, c.selections, c.selections.find(s => s.operation.rpc.method === method), params, signal, progress);
  c.reply = (notice, decision = 'accept') => v.session.replyNativeRuntime(c.reference.id, notice.token, decision);
  return c;
}
async function pending(c, method = reset, params = input(method)) {
  let notice, failure;
  const promise = c.execute(method, params, undefined, value => { if (value.kind === 'account-action-approval') notice = value; });
  void promise.catch(error => { failure = error; });
  await waitForWatch(() => notice || failure); assert.ifError(failure); return { promise, notice };
}

function controlledAccountActions(world, options = {}) {
  const c = { options, notices: [], requests: [], replies: [], jobs: [] };
  const transport = {
    async agent(_id, _host, _key, _fingerprint, _identity, _guard, events) {
      c.events = events; if (options.closeOpening) events.closed();
      if (options.approvalOpening) events.frame({ id: randomUUID(), method: nativeAccountActionApprovalMethod,
        params: { requestId: 'before-request', method: reset, params: input(reset), account: { account: null, requiresOpenaiAuth: true } } }, _identity);
      return { request(method, params, _signal, requestId) {
        const request = { method, params, requestId }; c.requests.push(request);
        return new Promise((resolve, reject) => { c.complete = request.resolve = resolve; c.reject = request.reject = reject; });
      }, reply(id, result) { c.replies.push({ id, result }); } };
    },
    close() { c.events?.closed(); c.reject?.(new VaultError('NATIVE_UNKNOWN')); }
  };
  c.broker = new NativeAccountActionBroker(transport);
  c.connection = { id: randomUUID(), host: 'https://owned.example.test', identity: { runtimeId: randomUUID(), generation: randomUUID(), accountEpoch: randomUUID(),
    version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64) } };
  c.start = (signal, progress = true) => {
    const work = c.broker.execute(c.connection, 'c'.repeat(43), 'd'.repeat(64), reset, input(reset), async () => options.guard?.(c), signal, progress ? value => c.notices.push(value) : undefined);
    void work.catch(() => {}); c.jobs.push(work); return work;
  };
  c.approval = () => ({ id: randomUUID(), method: nativeAccountActionApprovalMethod, params: { requestId: c.requests.at(-1).requestId, method: reset,
    params: input(reset), account: { account: null, requiresOpenaiAuth: true } } });
  c.emit = (frame = c.approval(), identity = c.connection.identity) => {
    try { return c.events.frame(frame, identity); } catch (error) { transport.close(); throw error; }
  };
  c.close = () => transport.close();
  world.accountActionFixtures.push({ v: { session: { lock: c.close } }, f: { async close() { c.close(); await Promise.allSettled(c.jobs); } } });
  return c;
}

Then('private account approvals bind their exact method input identity and active request', async function () {
  for (const mode of ['request', 'method', 'params', 'identity', 'id', 'duplicate', 'approved', 'declined', 'foreign-call']) {
    const c = controlledAccountActions(this), work = c.start(); await waitForWatch(() => c.requests.length === 1);
    await assert.rejects(c.start(), { code: 'CONFLICT' });
    assert.equal(c.emit({ method: 'account/publicNotice', params: {} }), true);
    const frame = c.approval(); let identity = c.connection.identity;
    if (mode === 'request') frame.params.requestId = 'foreign';
    if (mode === 'method') frame.params.method = email;
    if (mode === 'params') frame.params.params.idempotencyKey = 'changed';
    if (mode === 'identity') identity = { ...identity, accountEpoch: randomUUID() };
    if (mode === 'id') frame.id = 'foreign';
    if (['duplicate', 'approved', 'declined'].includes(mode)) {
      c.emit();
      if (mode !== 'duplicate') await c.broker.reply(c.connection.id, c.notices[0].token, mode === 'approved' ? 'accept' : 'decline');
    }
    assert.throws(() => c.emit(mode === 'foreign-call' ? { id: randomUUID(), method: 'unowned/request', params: {} } : frame, identity), { code: 'AUTHORIZATION' });
    await assert.rejects(work, { code: mode === 'declined' ? 'CANCELLED' : 'NATIVE_UNKNOWN' });
  }
});

Then('private account reply capabilities retain signal identity and post-guard cancellation', async function () {
  for (const mode of ['accept', 'cancel', 'aborted', 'closed']) {
    let release, entered = false;
    const c = controlledAccountActions(this), controller = new AbortController(), work = c.start(controller.signal);
    await waitForWatch(() => c.requests.length === 1); c.emit(); const token = c.notices[0].token;
    assert.equal(c.broker.ownsApproval(c.connection.id, token), true);
    await assert.rejects(c.broker.reply(c.connection.id, token, 'accept', new AbortController().signal), { code: 'PERMISSION' });
    await assert.rejects(c.broker.reply(c.connection.id, token, 'unreviewed'), { code: 'PERMISSION' });
    if (mode === 'aborted' || mode === 'closed') c.options.guard = () => new Promise(resolve => { entered = true; release = resolve; });
    const reply = c.broker.reply(c.connection.id, token, mode === 'cancel' ? 'cancel' : 'accept', controller.signal); void reply.catch(() => {});
    if (mode === 'aborted' || mode === 'closed') {
      await waitForWatch(() => entered);
      if (mode === 'aborted') controller.abort(); else c.close();
      release(); await assert.rejects(reply, { code: 'PERMISSION' });
    } else { await reply; assert.equal(c.broker.ownsApproval(c.connection.id, token), false); }
    c.options.guard = undefined; c.complete({ outcome: 'reset' });
    if (mode === 'accept') assert.deepEqual(await work, { outcome: 'reset' });
    else await assert.rejects(work, { code: mode === 'cancel' ? 'CANCELLED' : mode === 'aborted' ? 'AUTHORIZATION' : 'NATIVE_UNKNOWN' });
  }
});

Then('private account results require an approved live owner even without a progress subscriber', async function () {
  const opening = controlledAccountActions(this, { closeOpening: true }); await assert.rejects(opening.start(), { code: 'NATIVE_UNKNOWN' });
  assert.deepEqual(opening.requests, []);
  const early = controlledAccountActions(this, { approvalOpening: true }); await assert.rejects(early.start(), { code: 'AUTHORIZATION' });
  const noProgress = controlledAccountActions(this), unapproved = noProgress.start(undefined, false); await waitForWatch(() => noProgress.requests.length === 1);
  noProgress.emit(); assert.deepEqual(noProgress.notices, []); noProgress.complete({ outcome: 'reset' }); await assert.rejects(unapproved, { code: 'AUTHORIZATION' });
  const stale = controlledAccountActions(this), work = stale.start(); await waitForWatch(() => stale.requests.length === 1); stale.emit();
  stale.options.guard = async () => { throw new VaultError('PERMISSION'); };
  await assert.rejects(stale.broker.reply(stale.connection.id, stale.notices[0].token, 'accept'), { code: 'PERMISSION' });
  await assert.rejects(work, { code: 'NATIVE_UNKNOWN' });
});

Then('a superseded account action response cannot clear the current approval owner', async function () {
  const c = controlledAccountActions(this), first = c.start(), current = c.start(); await waitForWatch(() => c.requests.length === 2);
  c.emit(); const token = c.notices[0].token;
  c.requests[0].resolve({ outcome: 'reset' }); await assert.rejects(first, { code: 'AUTHORIZATION' });
  assert.equal(c.broker.ownsApproval(c.connection.id, token), true);
  await c.broker.reply(c.connection.id, token, 'accept'); c.requests[1].resolve({ outcome: 'reset' });
  assert.deepEqual(await current, { outcome: 'reset' });
});
Then('account action inputs preserve native reset and email semantics', function () {
  assert.deepEqual(nativeAccountActionParams(reset, input(reset)), input(reset));
  for (const creditId of [undefined, null]) {
    const params = { idempotencyKey: 'opaque non-UUID', ...(creditId === undefined ? {} : { creditId }) };
    assert.deepEqual(nativeAccountActionParams(reset, params), params);
  }
  for (const creditType of ['credits', 'usage_limit']) assert.deepEqual(nativeAccountActionParams(email, { creditType }), { creditType });
  for (const outcome of ['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed']) assert.deepEqual(nativeAccountActionResult(reset, { outcome }), { outcome });
  for (const status of ['sent', 'cooldown_active']) assert.deepEqual(nativeAccountActionResult(email, { status }), { status });
});
Then('account action input validation identifies invalid and unsupported fields', function () {
  for (const [method, params, field] of [[reset, {}, 'idempotencyKey'], [reset, { idempotencyKey: '' }, 'idempotencyKey'],
    [reset, { idempotencyKey: 42 }, 'idempotencyKey'], [reset, { idempotencyKey: 'owned', creditId: '' }, 'creditId'],
    [reset, { idempotencyKey: 'owned', creditId: false }, 'creditId'], [email, {}, 'creditType'], [email, { creditType: 'usageLimit' }, 'creditType']])
    assert.throws(() => nativeAccountActionParams(method, params), error => error.field === field);
  for (const method of nativeAccountActionMethods) for (const field of ['apiKey', 'accountId', 'endpoint', 'headers'])
    assert.throws(() => nativeAccountActionParams(method, { ...input(method), [field]: 'unavailable' }), error => error.field === field);
  for (const value of [{ status: ['sent'] }, { status: 'sent', private: true }, { status: 'unknown' }]) assert.throws(() => nativeAccountActionResult(email, value));
});
Then('account actions publish only their approved native outcomes', async function () {
  const c = await setup(this), before = c.reference;
  for (const [method, result] of [...['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'].map(outcome => [reset, { outcome }]), ...['sent', 'cooldown_active'].map(status => [email, { status }])]) {
    c.f.actionResult = result; const count = dispatches(c).length, work = await pending(c, method);
    assert.equal(dispatches(c).length, count); assert.deepEqual(work.notice.params, input(method)); assert.equal(work.notice.account.account.type, 'chatgpt');
    await c.reply(work.notice); const actual = await work.promise;
    assert.deepEqual(actual.response.result, result); assert.deepEqual(actual.request.params, input(method)); assert.equal(dispatches(c).length, count + 1);
    assert.equal(JSON.stringify(actual).includes(work.notice.token), false); assert.deepEqual(c.reference, before);
  }
});
Then('account action approval tokens are owned single use and optional to decline', async function () {
  const c = await setup(this), work = await pending(c);
  await assert.rejects(c.reply({ token: randomUUID() }), error => error.code === 'PERMISSION'); assert.equal(dispatches(c).length, 0);
  await c.reply(work.notice, 'decline'); await assert.rejects(work.promise, error => error.code === 'CANCELLED'); assert.equal(dispatches(c).length, 0);
  await waitForWatch(() => c.f.starts === c.f.stops);
  await assert.rejects(c.reply(work.notice), error => error.code === 'PERMISSION');
  const next = await pending(c); await c.reply(next.notice); await next.promise;
  await assert.rejects(c.reply(next.notice), error => error.code === 'PERMISSION'); assert.equal(dispatches(c).length, 1);
});
Then('account action approvals lose changed authority before dispatch', async function () {
  for (const change of [c => { c.v.enabled = false; }, c => { c.f.identity.accountEpoch = randomUUID(); }, c => { c.f.identity.configuration = 'd'.repeat(64); }]) {
    const c = await setup(this), work = await pending(c); change(c);
    try { await c.reply(work.notice); } catch { /* Both reply and pending request fail closed. */ }
    await assert.rejects(work.promise); assert.equal(dispatches(c).length, 0);
  }
});
Then('changed native authority withholds a dispatched action result', async function () {
  const c = await setup(this), before = c.reference; c.f.holdActions = true;
  const work = await pending(c); await c.reply(work.notice); await waitForWatch(() => dispatches(c).length === 1);
  c.f.identity.accountEpoch = randomUUID(); c.f.finishAction(); await assert.rejects(work.promise); assert.deepEqual(c.reference, before);
});
Then('account actions require their independent grant and reject agent escalation', async function () {
  const denied = await setup(this, { allowAccountActions: false }); await assert.rejects(denied.execute(reset)); assert.equal(dispatches(denied).length, 0);
  const c = await setup(this); await c.v.session.disconnectNativeRuntime(c.reference); await waitForWatch(() => c.f.starts === c.f.stops);
  const ticket = await c.f.ticket({ connectionId: randomUUID(), method: 'codex-account-actions', fingerprint: 'a'.repeat(64) }); assert.equal(ticket.status, 200);
  const socket = await c.f.socket(ticket.value.ticket); await socket.next(); socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next();
  socket.ws.send(JSON.stringify({ method: 'initialized' })); socket.ws.send(JSON.stringify({ id: 'agent', method: 'thread/start', params: {} }));
  await waitForWatch(() => socket.ws.readyState === 3); assert.ok(!c.f.frames.some(frame => frame.method === 'thread/start')); socket.ws.terminate();
});
Then('account actions withhold private metadata and malformed native replies', async function () {
  const c = await setup(this); c.f.account.email = c.f.backend.access;
  await assert.rejects(c.execute(reset), error => !error.message.includes(c.f.backend.access)); assert.equal(dispatches(c).length, 0);
  const other = await setup(this); other.f.actionResult = { status: other.f.backend.refresh };
  const work = await pending(other, email); await other.reply(work.notice); await assert.rejects(work.promise, error => !error.message.includes(other.f.backend.refresh));
});
Then('account action models preserve typed wire declarations and named fields', async function () {
  const source = await readServiceSchema('codex');
  for (const method of nativeAccountActionMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.deepEqual(scopeNativeRpcSchema(document, method), document);
    assert.deepEqual(operation.fields.map(f => f.name).sort(), method === reset ? ['creditId', 'idempotencyKey'] : ['creditType']);
    if (method === email) assert.deepEqual(operation.fields[0].enum, source.definitions.v2.AddCreditsNudgeCreditType.enum);
    const values = method === reset ? { 'params:idempotencyKey': 'owned retry / 42', 'params:creditId': 'opaque credit' } : { 'params:creditType': 'usage_limit' };
    assert.deepEqual(prepareNativeRequest(operation, values).params, method === reset ? { idempotencyKey: 'owned retry / 42', creditId: 'opaque credit' } : { creditType: 'usage_limit' });
    assert.deepEqual(document['x-operations-native-workflow'].wireConfirmation, { $ref: '#/definitions/v2/GetAccountResponse' });
  }
});
Then('the general agent scope cannot dispatch gateway or billing actions', async function () {
  const c = await setup(this, { allowAgent: true, allowAccountActions: false });
  await c.v.session.disconnectNativeRuntime(c.reference); await waitForWatch(() => c.f.starts === c.f.stops);
  for (const method of [...nativeAccountActionMethods, 'account/gatewayOAuth/login', 'account/gatewayOAuth/cancel']) {
    const ticket = await c.f.ticket({ connectionId: randomUUID(), method: 'codex-workflow', fingerprint: 'b'.repeat(64) }); assert.equal(ticket.status, 200);
    const socket = await c.f.socket(ticket.value.ticket); await socket.next(); socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next();
    socket.ws.send(JSON.stringify({ method: 'initialized' })); socket.ws.send(JSON.stringify({ id: 'action', method, params: nativeAccountActionMethods.includes(method) ? input(method) : {} }));
    await waitForWatch(() => socket.ws.readyState === 3); socket.ws.terminate(); await waitForWatch(() => c.f.starts === c.f.stops);
  }
  assert.equal(c.f.frames.some(frame => [...nativeAccountActionMethods, 'account/gatewayOAuth/login', 'account/gatewayOAuth/cancel'].includes(frame.method)), false);
});
Then('actual SDK account actions retain their backend payloads and result enums', { timeout: 45000 }, async function () {
  const f = await nativeAccountSdkFixture();
  try {
    for (const [code, outcome] of [['reset', 'reset'], ['nothing_to_reset', 'nothingToReset'], ['no_credit', 'noCredit'], ['already_redeemed', 'alreadyRedeemed']]) {
      f.backend.consumeCode = code; const params = { ...input(reset), idempotencyKey: 'owned-attempt-' + code };
      assert.deepEqual(await f.call(reset, params), { outcome }); assert.deepEqual(f.backend.actions.at(-1).body, { redeem_request_id: params.idempotencyKey, credit_id: params.creditId });
    }
    delete f.backend.consumeCode; const logical = { idempotencyKey: 'owned exact retry key' };
    assert.deepEqual(await f.call(reset, logical), { outcome: 'reset' }); assert.deepEqual(await f.call(reset, logical), { outcome: 'alreadyRedeemed' });
    for (const [status, expected] of [[200, 'sent'], [429, 'cooldown_active']]) {
      f.backend.emailStatus = status; assert.deepEqual(await f.call(email, { creditType: 'usage_limit' }), { status: expected });
      assert.deepEqual(f.backend.actions.at(-1).body, { credit_type: 'usage_limit' });
    }
    assert.ok(f.backend.actions.every(action => action.authorized)); assert.equal(f.backend.actions.length, 8);
  } finally { await f.close(); }
});
Then('actual paired account actions require explicit approval with provider auth {string}', { timeout: 45000 }, async function (required) {
  const c = await setup(this, { real: true, requiresOpenaiAuth: required === 'true' });
  assert.equal(c.connection.accountType, required === 'true' ? 'chatgpt' : 'none');
  for (const method of nativeAccountActionMethods) {
    const before = c.f.backend.actions.length, work = await pending(c, method);
    assert.equal(c.f.backend.actions.length, before); assert.equal(dispatches(c).length, before);
    await c.reply(work.notice); const result = await work.promise;
    assert.deepEqual(result.response.result, method === reset ? { outcome: 'reset' } : { status: 'sent' });
    assert.equal(c.f.backend.actions.length, before + 1); assert.equal(dispatches(c).length, before + 1);
  }
});
Then('the actual SDK rejects account actions without ChatGPT backend authentication', { timeout: 45000 }, async function () {
  for (const apiKey of [false, true]) {
    const f = await nativeAccountSdkFixture({ anonymous: !apiKey, ...(apiKey ? { async seedRuntime({ home }) {
      await writeFile(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'OWNED_ACTION_KEY_' + randomUUID() }), { mode: 0o600 });
    } } : {}) });
    try { for (const method of nativeAccountActionMethods) await assert.rejects(f.call(method, input(method)), /auth/i); assert.equal(f.backend.actions.length, 0); }
    finally { await f.close(); }
  }
});
Then('actual account action failures retain no private backend text or implicit retry', { timeout: 45000 }, async function () {
  for (const method of nativeAccountActionMethods) {
    const c = await setup(this, { real: true }); c.f.backend.consumeStatus = 500; c.f.backend.emailStatus = 500; c.f.backend.actionError = c.f.backend.access;
    const work = await pending(c, method); assert.equal(c.f.backend.actions.length, 0); await c.reply(work.notice);
    let failure;
    try { await work.promise; } catch (error) { failure = { code: error.code, leaked: error.message.includes(c.f.backend.access) }; }
    assert.deepEqual(failure, { code: 'NATIVE_FAILED', leaked: false }); assert.equal(c.f.backend.actions.length, 1); assert.equal(dispatches(c).length, 1);
  }
});
