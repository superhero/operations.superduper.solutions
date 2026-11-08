// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeAccountReadMethods, nativeAccountReadParams, nativeAccountReadResultTypes } from './lib/native-account-read.ts';
import { nativeAccountSdkFixture } from '../tests/native-account-read-sdk.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';
import { nativeAccountReadFixture } from '../tests/native-account-read.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';

Before({ tags: '@native-account-read' }, function () { this.accountReadFixtures = []; });
After({ tags: '@native-account-read' }, async function () { for (const c of this.accountReadFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeAccountReadFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.accountReadFixtures.push(c);
  c.selections = await v.workflowSelections();
  try { c.connection = await v.session.pairNativeRuntime(v.input, v.selection); }
  catch (error) { error.message += '\nOwned pairing shape diagnostics: ' + JSON.stringify({ methods: f.frames.map(frame => frame.method), shapes: f.nativeShapes }); throw error; }
  c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, input = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal);
  return c;
}
const calls = c => c.f.frames.filter(frame => nativeAccountReadMethods.includes(frame.method));
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);

Then('account read inputs preserve nullable thread queries and reject unsupported client claims', function () {
  for (const method of nativeAccountReadMethods) assert.deepEqual(nativeAccountReadParams(method, null), nativeAccountReadParams(method, {}));
  const threadId = randomUUID().toUpperCase(); assert.equal(nativeAccountReadParams('account/usage/read', { threadId }).threadId, threadId);
  assert.deepEqual(nativeAccountReadParams('account/rateLimits/read', { excludeResetCreditDetails: true }), { excludeResetCreditDetails: true, supportsLunaReserve: false });
  for (const [method, input, field] of [
    ['account/rateLimits/read', { supportsLunaReserve: true }, 'supportsLunaReserve'], ['account/rateLimits/read', { excludeResetCreditDetails: null }, 'excludeResetCreditDetails'],
    ['account/usage/read', { threadId: 'foreign-text' }, 'threadId'], ['account/workspaceMessages/read', { refreshToken: true }, 'refreshToken']
  ]) assert.throws(() => nativeAccountReadParams(method, input), error => error.field === field);
});
Then('account read models expose portable typed fields and exact wire results', async function () {
  const c = await setup(this);
  for (const method of nativeAccountReadMethods) {
    const selected = c.select(method), graph = createOperationGraph(selected.operation, { x: 0, y: 0 }, 'owner', selected.document);
    const document = { version: 3, id: 'account-read', name: 'Account read', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(document))), document);
    assert.equal(selected.operation.unavailableReason, undefined); assert.equal(selected.operation.rpc.result, true);
    assert.ok(selected.document['x-operations-native-workflow'].wireResult); assert.ok(selected.operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!selected.operation.capabilities.requirements.some(r => ['native-workspace', 'native-terminal'].includes(r.code)));
  }
  assert.throws(() => prepareNativeRequest(c.select('account/usage/read').operation, { 'params:threadId': 'foreign' }), error => error.fieldKey === 'params:threadId');
  assert.throws(() => prepareNativeRequest(c.select('account/rateLimits/read').operation, { 'params:supportsLunaReserve': 'true' }), error => error.fieldKey === 'params:supportsLunaReserve');
});
Then('account reads reject missing grants and anonymous or API key backend access', { timeout: 60000 }, async function () {
  const denied = await setup(this, { allowAccountRead: false, allowAgent: true });
  await assert.rejects(denied.execute('account/gatewayOAuth/read')); assert.equal(calls(denied).length, 0);
  for (const account of [null, { type: 'apiKey' }]) {
    const c = await setup(this, { account, requiresOpenaiAuth: false });
    assert.equal((await c.execute('account/gatewayOAuth/read')).response.result.required, false);
    for (const method of nativeAccountReadMethods.slice(1)) await assert.rejects(c.execute(method), error => error.code === 'AUTHORIZATION');
    assert.equal(calls(c).length, 1);
  }
});
Then('account read results reject foreign accounts threads and malformed messages', async function () {
  for (const [method, input, result] of [
    ['account/rateLimits/read', {}, { accountId: 'foreign-account', rateLimits: {} }],
    ['account/usage/read', { threadId: randomUUID() }, { threadUsage: { threadId: randomUUID() } }],
    ['account/workspaceMessages/read', {}, { featureEnabled: true, messages: [{ messageId: 'bad', messageBody: 'No required type' }] }]
  ]) { const c = await setup(this); c.f.readResult = result; await assert.rejects(c.execute(method, input)); assert.equal(calls(c).length, 1); }
});
Then('pending account reads reject source identity lock and cancellation changes', async function () {
  for (const mode of ['source', 'identity', 'credentials', 'lock', 'cancel']) {
    const c = await setup(this), controller = new AbortController(); c.f.holdReads = true;
    const pending = c.execute('account/workspaceMessages/read', {}, controller.signal); void pending.catch(() => {});
    await waitForWatch(() => c.f.release.length === 1);
    if (mode === 'source') c.v.enabled = false; else if (mode === 'identity') c.f.identity.generation = randomUUID();
    else if (mode === 'credentials') await writeFile(join(c.f.home, 'auth.json'), '{}', { mode: 0o600 });
    else if (mode === 'lock') c.v.session.lock(); else controller.abort();
    if (['source', 'identity', 'credentials'].includes(mode)) c.f.release[0]();
    await assert.rejects(pending); await ended(c); assert.equal(calls(c).length, 1);
  }
});
Then('four actual SDK account reads complete through the encrypted paired broker', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true }); assert.equal(c.connection.accountType, 'chatgpt'); assert.equal(c.connection.workflowFingerprint, undefined);
  const results = [];
  for (const method of nativeAccountReadMethods) results.push((await c.execute(method)).response.result);
  assert.equal(results[0].required, false); assert.equal(results[1].rateLimits.primary.usedPercent, 42);
  assert.equal(results[2].summary.lifetimeTokens, 12345); assert.equal(results[3].messages[0].messageBody, 'Owned workspace announcement');
  const threadId = randomUUID(), usage = (await c.execute('account/usage/read', { threadId: threadId.toUpperCase() })).response.result;
  assert.equal(usage.threadUsage.threadId, threadId); assert.equal(usage.threadUsage.groups[0].totalTokens, 140);
  assert.equal(c.f.starts, 2); assert.equal(calls(c).length, 5);
  assert.ok(!c.f.frames.some(frame => ['thread/start', 'turn/start', 'account/login/start'].includes(frame.method)));
  assert.ok(c.f.backend.requests.every(request => request.authorized || request.path === '/v1/models'));
  const before = c.f.backend.requests.filter(r => r.path === '/api/codex/rate-limit-reset-credits').length;
  await c.execute('account/rateLimits/read', { excludeResetCreditDetails: true });
  assert.equal(c.f.backend.requests.filter(r => r.path === '/api/codex/rate-limit-reset-credits').length, before);
  c.f.backend.messageStatus = 404;
  assert.deepEqual((await c.execute('account/workspaceMessages/read')).response.result, { featureEnabled: false, messages: [] });
});
Then('native account credentials and encoded echoes remain private at the companion', { timeout: 45000 }, async function () {
  for (const encoding of ['plain', 'base64url', 'utf16-base64', 'utf16-le', 'utf16-be']) {
    const c = await setup(this, { real: true }), secret = c.f.backend.access;
    const message = encoding === 'plain' ? secret : encoding === 'base64url' ? Buffer.from(secret).toString('base64url')
      : encoding === 'utf16-base64' ? Buffer.from(secret, 'utf16le').toString('base64')
        : encoding === 'utf16-le' ? Buffer.from(secret, 'utf16le').toString('utf8') : Buffer.from(secret, 'utf16le').swap16().toString('utf8');
    c.f.backend.messages = { messages: [{ message_id: 'owned-echo', message_type: 'announcement', message_body: message, created_at: null, archived_at: null }] };
    await assert.rejects(c.execute('account/workspaceMessages/read')); await ended(c); assert.equal(calls(c).length, 1);
  }
});
Then('the pinned SDK reads gateway readiness usage limits and workspace messages through the owned backend', { timeout: 45000 }, async function () {
  const f = await nativeAccountSdkFixture();
  try {
    const source = await readServiceSchema('codex'), call = f.call;
    f.call = async (method, params) => { const result = await call(method, params); if (nativeAccountReadMethods.includes(method))
      validateNativeQueryResult(result, { $ref: '#/definitions/v2/' + nativeAccountReadResultTypes[method] }, source, true); return result; };
    const account = await f.call('account/read', { refreshToken: false }); assert.equal(account.account.type, 'chatgpt');
    const gateway = await f.call('account/gatewayOAuth/read'); assert.equal(gateway.required, false); assert.equal(gateway.providerId, 'operations_account_fixture');
    const limits = await f.call('account/rateLimits/read', nativeAccountReadParams('account/rateLimits/read', {})); assert.equal(limits.rateLimits.primary.usedPercent, 42); assert.equal(limits.accountId, f.backend.accountId);
    const usage = await f.call('account/usage/read'); assert.equal(usage.summary.lifetimeTokens, 12345); assert.equal(usage.dailyUsageBuckets[0].tokens, 2345);
    const threadId = randomUUID(), thread = await f.call('account/usage/read', { threadId }); assert.equal(thread.threadUsage.threadId, threadId); assert.equal(thread.threadUsage.groups[0].totalTokens, 140);
    const messages = await f.call('account/workspaceMessages/read'); assert.equal(messages.featureEnabled, true); assert.equal(messages.messages[0].messageBody, 'Owned workspace announcement');
    assert.ok(f.backend.requests.every(request => request.authorized || request.path === '/v1/models'));
    assert.ok(f.backend.requests.every(request => request.method === 'GET' || request.path === '/api/codex/usage/thread_usage/query'));
    assert.ok(nativeAccountReadMethods.every(method => f.calls.includes(method)));
  } finally { await f.close(); }
});
