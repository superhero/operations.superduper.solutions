// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeHostFixture } from '../tests/native-runtime.fixture.mjs';
import { nativeVaultFixture as vault } from '../tests/native-vault.fixture.mjs';
import { NativeRuntimeBroker } from './lib/secrets/native-runtime.ts';
import { nativeHost, nativeReference, validateNativeConnection, validateNativeBinding, storedNativeConnections } from './lib/secrets/native-runtime-config.ts';
import { NativeRuntimeBroker as Broker } from './lib/secrets/native-runtime.ts';
import { nativeRuntimeProfile, nativeRuntimeLimits, nativeScope } from './lib/native-runtime-contract.ts';
import { VaultError } from './lib/secrets/types.ts';
import { decryptJSON, encryptJSON, recoveryKey, unwrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { publicNativeAccountResult, nativeAccountParams } from './lib/native-account.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { nativeInitializeParams, publicNativeInitializeResult } from './lib/native-initialize.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { nativeRpcOperation, scopeNativeRpcSchema } from './lib/native-rpc.ts';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';

Before({ tags: '@native-runtime' }, function () { this.nativeFixtures = []; this.nativeBrokers = []; });
After({ tags: '@native-runtime' }, async function () {
  for (const broker of this.nativeBrokers) broker.clear();
  for (const f of this.nativeFixtures.reverse()) await f.close();
});
const wait = async predicate => {
  const deadline = Date.now() + 1500;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('The owned native transition did not finish.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function fixture(world, options) { const f = await nativeHostFixture(options); world.nativeFixtures.push(f); return f; }

async function initializeFixture(world) {
  const f = await fixture(world, { onFrame(frame, f, receive) {
    if (frame.method !== 'initialize') return;
    f.initializations = (f.initializations ?? 0) + 1;
    const result = Object.hasOwn(f, 'initializeResult') ? f.initializeResult : { codexHome: '/private/owned-codex',
      platformFamily: 'unix', platformOs: 'linux', userAgent: 'codex/0.163.0 initialization-' + f.initializations };
    const reply = () => receive({ id: frame.id, result });
    if (f.holdInitialize) f.release.push(reply); else queueMicrotask(reply);
    return true;
  } });
  const v = await vault(f), source = await readServiceSchema('codex'), document = scopeNativeRpcSchema(source, 'initialize');
  return { f, v, selection: { operation: nativeRpcOperation(document, 'codex:initialize'), document } };
}

Then('native initialization workflows use new owned children and preserve the public handshake result', async function () {
  const { f, v, selection } = await initializeFixture(this);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection);
    assert.deepEqual(selection.operation.capabilities.requirements.map(item => item.code), ['native-host']);
    assert.deepEqual(selection.operation.rpc.workflowResult, { $ref: '#/definitions/InitializeResponse' });
    for (const number of [2, 3]) {
      const request = prepareNativeRequest(selection.operation, {});
      const result = await v.session.executeNativeInitialize(nativeReference(paired), v.selection, selection, request.params);
      assert.deepEqual(result.request, { protocol: 'json-rpc', method: 'initialize', params: nativeInitializeParams() });
      assert.deepEqual(result.response.result, { codexHome: '/private/owned-codex', platformFamily: 'unix', platformOs: 'linux', userAgent: 'codex/0.163.0 initialization-' + number });
      await wait(() => f.frames.filter(frame => frame.method === 'initialized').length === number);
      assert.equal(f.starts, number); assert.equal(f.stops, number - 1);
    }
    assert.equal(f.frames.filter(frame => frame.method === 'account/read').length, 1);
    assert.ok(f.frames.every(frame => !frame.method || ['initialize', 'initialized', 'account/read'].includes(frame.method)));
    assert.equal(JSON.stringify(v.storage.state).includes(f.key), false);
    // The initialize-scoped connection cannot be reused as an account read.
    const account = await v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false });
    assert.equal(account.response.result.account, null); assert.equal(f.starts, 4);
    v.session.lock(); await wait(() => f.stops === f.starts);
  } finally { v.session.lock(); }
});

Then('native initialization workflows reject unowned clients experimental capabilities and changed selections', async function () {
  const { f, v, selection } = await initializeFixture(this);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection), before = f.frames.length;
    for (const input of [{ 'params:capabilities': '{"experimentalApi":true}' }, { 'params:clientInfo': '{}' }]) assert.throws(() => prepareNativeRequest(selection.operation, input));
    for (const input of [{}, { ...nativeInitializeParams(), extra: true }, { ...nativeInitializeParams(), clientInfo: { name: 'other', version: '1' } },
      { ...nativeInitializeParams(), capabilities: { experimentalApi: true } }, { ...nativeInitializeParams(), capabilities: { experimentalApi: false, explicitGatewayOauth: false } }, { ...nativeInitializeParams(), capabilities: { experimentalApi: false, requestAttestation: true } }]) {
      assert.throws(() => nativeInitializeParams(input));
      await assert.rejects(v.session.executeNativeInitialize(nativeReference(paired), v.selection, selection, input));
    }
    assert.equal(f.frames.length, before);
    await assert.rejects(v.session.executeNativeInitialize(nativeReference(paired), selection, selection, nativeInitializeParams()), error => error.code === 'PERMISSION');
    await assert.rejects(v.session.executeNativeInitialize(nativeReference(paired), v.selection, v.selection, nativeInitializeParams()), error => error.code === 'PERMISSION');
    assert.equal(f.frames.length, before);
    await wait(() => f.stops === f.starts);
    const issued = await f.ticket({ connectionId: randomUUID(), method: 'initialize', fingerprint: 'c'.repeat(64) }), socket = await f.socket(issued.value.ticket);
    await socket.next(); socket.ws.send(JSON.stringify(initialize)); await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
    socket.ws.send(JSON.stringify({ id: 'unowned-read', method: 'account/read', params: { refreshToken: false } }));
    assert.equal(await socket.next(), undefined); await socket.close();
    assert.equal(f.frames.filter(frame => frame.method === 'account/read').length, 1);
  } finally { v.session.lock(); }
});

Then('native initialization workflow results reject malformed paths unknown fields and credential echoes', async function () {
  const valid = { codexHome: '/private/owned-codex', platformFamily: 'unix', platformOs: 'linux', userAgent: 'codex/0.163.0' };
  assert.deepEqual(publicNativeInitializeResult({ ...valid, codexHome: 'C:\\private\\codex', platformFamily: 'windows', platformOs: 'windows' }).platformOs, 'windows');
  for (const result of [{ ...valid, codexHome: 'relative' }, { ...valid, token: 'unclassified' }, { ...valid, platformFamily: null },
    { ...valid, userAgent: 'invalid\nvalue' }, { userAgent: valid.userAgent }]) assert.throws(() => publicNativeInitializeResult(result));
  const { f, v, selection } = await initializeFixture(this);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection), secret = 'SYNTHETIC_INITIALIZE_ECHO_040';
    await v.session.put(null, { label: 'Unrelated private value', kind: 'secret', value: secret });
    f.initializeResult = { ...valid, userAgent: secret };
    await assert.rejects(v.session.executeNativeInitialize(nativeReference(paired), v.selection, selection, nativeInitializeParams()), error => error.code === 'REDACTED');
    await wait(() => f.stops === f.starts);
    f.initializeResult = { ...valid, token: 'unclassified' };
    await assert.rejects(v.session.executeNativeInitialize(nativeReference(paired), v.selection, selection, nativeInitializeParams()), error => error.code === 'AUTHORIZATION');
    await wait(() => f.stops === f.starts);
  } finally { v.session.lock(); }
});

Then('native initialization cancellation and source changes close only their owned child', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'stale']) {
    const { f, v, selection } = await initializeFixture(this), controller = new AbortController();
    try {
      const paired = await v.session.pairNativeRuntime(v.input, v.selection);
      if (mode === 'stale') {
        const before = f.frames.length;
        await assert.rejects(v.session.executeNativeInitialize({ ...nativeReference(paired), revision: 2 }, v.selection, selection, nativeInitializeParams()), error => error.code === 'CONFLICT');
        assert.equal(f.frames.length, before); continue;
      }
      f.holdInitialize = true;
      const work = v.session.executeNativeInitialize(nativeReference(paired), v.selection, selection, nativeInitializeParams(), controller.signal);
      await wait(() => f.release.length === 1);
      if (mode === 'cancel') controller.abort();
      else { if (mode === 'source') v.enabled = false; else f.identity.workspace = 'd'.repeat(64); f.release[0](); }
      await assert.rejects(work, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'AUTHORIZATION', 'NETWORK'].includes(error.code));
      await wait(() => f.stops === f.starts);
    } finally { v.session.lock(); }
  }
});

Then('paired native account workflows preserve public results and encrypted authority across reload', async function () {
  for (const account of [null, undefined, { type: 'apiKey' }, { type: 'chatgpt', email: null, planType: 'pro' }]) {
    const f = await fixture(this); f.account = account;
    const v = await vault(f);
    try {
      const paired = await v.session.pairNativeRuntime(v.input, v.selection);
      assert.equal(paired.workflowFingerprint, undefined);
      assert.equal(v.selection.operation.unavailableReason, undefined);
      assert.deepEqual(v.selection.operation.capabilities.requirements.map(item => item.code), ['native-host']);
      for (const planType of v.selection.document.definitions.v2.PlanType.enum)
        assert.equal(publicNativeAccountResult({ account: { type: 'chatgpt', email: null, planType }, requiresOpenaiAuth: true }).account.planType, planType);
      const result = await v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false });
      assert.deepEqual(result.request, { protocol: 'json-rpc', method: 'account/read', params: { refreshToken: false } });
      assert.deepEqual(result.response.result, { requiresOpenaiAuth: true, ...(account !== undefined ? { account } : {}) });
      if (account === null) {
        for (const routing of [null, { chatgptAccountId: 'owned-workspace', backendOrigin: 'https://backend.example.test', accountRoutingOverride: 'NO_CONSTRAINT' },
          { chatgptAccountId: 'owned-workspace', backendOrigin: 'https://backend.example.test', accountRoutingOverride: 'us' },
          { chatgptAccountId: 'owned-workspace', backendOrigin: 'https://backend.example.test', accountRoutingOverride: 'us_cr' }]) {
          f.workspaceRouting = routing;
          assert.deepEqual((await v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false })).response.result,
            { requiresOpenaiAuth: true, account: null, workspaceRouting: routing });
        }
        delete f.workspaceRouting;
      }
      assert.ok(f.frames.every(frame => !frame.method || ['initialize', 'initialized', 'account/read'].includes(frame.method)));
      assert.ok(f.frames.filter(frame => frame.method === 'account/read').every(frame => frame.params.refreshToken === false));
      assert.equal(JSON.stringify(v.storage.state).includes(f.key), false);
      if (account === null) {
        v.session.lock(); await wait(() => f.stops === 1); await v.session.unlock(v.proof);
        assert.equal((await v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false })).response.result.account, null);
      }
    } finally { v.session.lock(); }
  }
});

Then('native account workflow inputs reject refresh and overrides before any native dispatch', async function () {
  const f = await fixture(this), v = await vault(f);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection), before = f.frames.length;
    for (const values of [{ 'params:refreshToken': 'true' }, { 'params:refreshToken': null }, { 'params:cwd': '/unowned' }, { 'params:apiKey': 'raw-key' }])
      assert.throws(() => prepareNativeRequest(v.selection.operation, values));
    for (const params of [{ refreshToken: true }, { refreshToken: false, cwd: '/unowned' }, {}]) {
      assert.throws(() => nativeAccountParams(params));
      await assert.rejects(v.session.executeNativeAccount(nativeReference(paired), v.selection, params));
    }
    assert.equal(f.frames.length, before);
    assert.deepEqual(prepareNativeRequest(v.selection.operation, {}).params, { refreshToken: false });
    assert.deepEqual(prepareNativeRequest(v.selection.operation, { 'params:refreshToken': 'false' }).params, { refreshToken: false });
  } finally { v.session.lock(); }
});

Then('native account workflows reject internal malformed and credential bearing results', async function () {
  for (const value of [{ account: { type: 'amazonBedrock' }, requiresOpenaiAuth: false }, { account: undefined, requiresOpenaiAuth: true },
    { account: null, requiresOpenaiAuth: 'true' }, { account: { type: 'apiKey', apiKey: 'unexpected' }, requiresOpenaiAuth: true },
    { account: { type: 'chatgpt', email: null, planType: 'unreviewed' }, requiresOpenaiAuth: true },
    { account: null, requiresOpenaiAuth: true, accessToken: 'unexpected' },
    { account: null, requiresOpenaiAuth: true, workspaceRouting: undefined },
    { account: null, requiresOpenaiAuth: true, workspaceRouting: { chatgptAccountId: 'owned', backendOrigin: {}, accountRoutingOverride: 'us' } },
    { account: null, requiresOpenaiAuth: true, workspaceRouting: { chatgptAccountId: 'owned', backendOrigin: 'https://backend.test', accountRoutingOverride: 'unknown' } },
    { account: null, requiresOpenaiAuth: true, workspaceRouting: { chatgptAccountId: 'owned', backendOrigin: 'https://backend.test', accountRoutingOverride: 'us', accessToken: 'unexpected' } }]) assert.throws(() => publicNativeAccountResult(value));
  const f = await fixture(this, { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'free' } }), v = await vault(f);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection), secret = 'SYNTHETIC_ACCOUNT_ECHO_040';
    await v.session.put(null, { label: 'Unrelated private key', kind: 'secret', value: secret });
    f.account = { type: 'chatgpt', email: secret, planType: 'free' };
    await assert.rejects(v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false }), error => error.code === 'REDACTED');
    await wait(() => f.stops === 1);
    f.account = { type: 'chatgpt', email: 'fixture@example.test', planType: 'free', token: 'unclassified' };
    await assert.rejects(v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false }), error => error.code === 'AUTHORIZATION');
    await wait(() => f.stops === f.starts); f.account = { type: 'chatgpt', email: 'fixture@example.test', planType: 'free' };
    f.workspaceRouting = { chatgptAccountId: secret, backendOrigin: 'https://backend.test', accountRoutingOverride: 'us' };
    await assert.rejects(v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false }), error => error.code === 'REDACTED');
  } finally { v.session.lock(); }
});

Then('native account workflow cancellation stale references and changed sources retain ownership', async function () {
  for (const mode of ['cancel', 'source', 'account', 'workspace']) {
    const f = await fixture(this), v = await vault(f), controller = new AbortController();
    try {
      const paired = await v.session.pairNativeRuntime(v.input, v.selection), before = f.frames.length;
      await assert.rejects(v.session.executeNativeAccount({ ...nativeReference(paired), revision: paired.revision + 1 }, v.selection, { refreshToken: false }), error => error.code === 'CONFLICT');
      assert.equal(f.frames.length, before); await wait(() => f.stops === 1); f.hold = true;
      const result = v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false }, controller.signal);
      await wait(() => f.release.length === 1);
      if (mode === 'cancel') controller.abort();
      else { if (mode === 'source') v.enabled = false; else if (mode === 'account') f.identity.accountEpoch = randomUUID(); else f.identity.workspace = 'd'.repeat(64); f.release[0](); }
      await assert.rejects(result, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'NETWORK', 'AUTHORIZATION'].includes(error.code));
      await wait(() => f.stops === 2);
    } finally { v.session.lock(); }
  }
});
function broker(world, f) { const value = new NativeRuntimeBroker(f.runtime); world.nativeBrokers.push(value); return value; }
const initialize = { id: 'init', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false } } };
async function raw(f) {
  const { value } = await f.ticket(), socket = await f.socket(value.ticket);
  assert.equal((await socket.next()).type, 'paired');
  socket.ws.send(JSON.stringify(initialize)); assert.equal((await socket.next()).id, 'init');
  socket.ws.send(JSON.stringify({ method: 'initialized' })); return socket;
}

Then('native pairing rejects unsafe hosts origins and missing authorization before a child starts', async function () {
  const f = await fixture(this);
  for (const value of ['http://127.0.0.1', 'https://user:secret@host.test', 'https://host.test/path', 'https://host.test?key=secret', 'https://host.test#key', 'https://host.test\\evil']) assert.throws(() => nativeHost(value));
  assert.equal((await f.ticket(undefined, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.ticket(undefined, { Authorization: '' })).status, 401);
  const preflight = await f.fetch(f.publicOrigin + '/v1/codex/tickets', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), f.applicationOrigin);
  assert.equal(preflight.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const outsider = await f.socket(undefined, { origin: 'https://foreign.test' }); assert.equal(outsider.ws.readyState, 3);
  assert.equal(f.starts, 0);
});

Then('native pairing consumes tickets once and rejects expiry replay and queue exhaustion', async function () {
  const f = await fixture(this), expired = await f.ticket(); f.advance(nativeRuntimeLimits.ticketMs + 1);
  const old = await f.socket(expired.value.ticket); assert.equal(await old.next(), undefined); assert.equal(f.starts, 0);
  const issued = await f.ticket(), first = await f.socket(issued.value.ticket); assert.equal((await first.next()).profile, nativeRuntimeProfile);
  await first.close(); await wait(() => f.stops === 1);
  const replay = await f.socket(issued.value.ticket); assert.equal(await replay.next(), undefined); assert.equal(f.starts, 1);
  for (let index = 0; index < nativeRuntimeLimits.tickets; index++) assert.equal((await f.ticket()).status, 200);
  assert.equal((await f.ticket()).status, 409);
});

Then('native pairing enforces its reviewed method parameters and native initialization order', async function () {
  const f = await fixture(this), socket = await raw(f);
  socket.ws.send(JSON.stringify({ id: 'forbidden', method: 'command/exec', params: { command: 'never' } }));
  await socket.close(); await wait(() => f.stops === 1);
  assert.ok(!f.frames.some(frame => frame.method === 'command/exec'));
  const issued = await f.ticket(), uninitialized = await f.socket(issued.value.ticket); await uninitialized.next();
  uninitialized.ws.send(JSON.stringify({ id: 'early', method: 'account/read', params: { refreshToken: false } }));
  assert.equal(await uninitialized.next(), undefined); await uninitialized.close();
  const next = await raw(f);
  next.ws.send(JSON.stringify({ id: 'refresh', method: 'account/read', params: { refreshToken: true } }));
  assert.equal(await next.next(), undefined); assert.ok(!f.frames.some(frame => frame.params?.refreshToken === true));
});

Then('native pairing correlates concurrent requests and rejects foreign responses', async function () {
  const f = await fixture(this), socket = await raw(f); f.hold = true;
  for (const id of ['one', 'two']) socket.ws.send(JSON.stringify({ id, method: 'account/read', params: { refreshToken: false } }));
  await wait(() => f.release.length === 2); f.release.reverse().forEach(done => done());
  assert.equal((await socket.next()).id, 'two'); assert.equal((await socket.next()).id, 'one');
  f.emit({ id: 'foreign', result: {} }); await socket.close(); await wait(() => f.stops === 1);
});

Then('the native worker broker pairs initializes and returns only safe connection metadata', async function () {
  const f = await fixture(this, { account: { type: 'chatgpt', email: 'private@example.test', planType: 'team' } }), b = broker(this, f);
  const result = await b.check(randomUUID(), f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {});
  assert.equal(result.accountType, 'chatgpt'); assert.equal(result.identity.version, '0.163.0');
  assert.ok(!JSON.stringify(result).includes(f.key)); assert.ok(!JSON.stringify(result).includes('private@example.test'));
  assert.deepEqual(f.frames.map(frame => frame.method), ['initialize', 'initialized', 'account/read']);
  assert.ok(f.requests.every(request => !request.path.includes('?'))); assert.ok(f.sockets.every(socket => socket.protocol === undefined && !socket.path.includes('?')));
});

Then('native saved pairings persist encrypted and reconnect to the same runtime only', async function () {
  const f = await fixture(this), v = await vault(f);
  const connection = await v.session.pairNativeRuntime(v.input, v.selection);
  assert.ok(!JSON.stringify(v.storage.state).includes(f.key)); assert.deepEqual(await v.session.connections(), []);
  v.session.lock(); await wait(() => f.stops === 1);
  v.session = v.newSession(); await v.session.unlock(v.proof);
  assert.equal((await v.session.nativeConnections())[0].connected, false);
  const current = await v.session.checkNativeRuntime(nativeReference(connection), v.selection);
  assert.deepEqual(current.identity, connection.identity); assert.equal(current.connected, true);
  await assert.rejects(v.session.checkNativeRuntime({ ...nativeReference(connection), revision: 2 }, v.selection), { code: 'CONFLICT' });
  v.session.lock();
});

Then('native pairings reject changed runtime account workspace source and pairing keys', async function () {
  for (const field of ['runtimeId', 'generation', 'workspace', 'configuration', 'accountEpoch', 'source', 'key']) {
    const f = await fixture(this), v = await vault(f), connection = await v.session.pairNativeRuntime(v.input, v.selection);
    if (field === 'source') v.enabled = false;
    else if (field === 'key') await v.session.put(null, { id: v.keyId, label: 'Native pairing key', kind: 'secret', value: 'B'.repeat(43) });
    else f.identity[field] = ['workspace', 'configuration'].includes(field) ? 'd'.repeat(64) : randomUUID();
    await assert.rejects(v.session.checkNativeRuntime(nativeReference(connection), v.selection));
    await wait(() => f.stops === f.starts);
    const saved = await v.session.nativeConnections(); assert.ok(saved.every(item => !item.connected));
    if (field === 'key') assert.deepEqual(saved, []);
    v.session.lock();
  }
});

Then('native pairing cancellation and expiry close owned requests without retry or logout', async function () {
  const f = await fixture(this), b = broker(this, f), controller = new AbortController(); f.hold = true;
  const pending = b.check(randomUUID(), f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {}, controller.signal);
  await wait(() => f.release.length === 1); controller.abort(); await assert.rejects(pending, { code: 'CANCELLED' });
  await wait(() => f.stops === 1); assert.equal(f.frames.filter(frame => frame.method === 'account/read').length, 1);
  assert.ok(!f.frames.some(frame => frame.method === 'account/logout'));
  const second = await fixture(this), timeout = broker(this, { ...second, runtime: { ...second.runtime, requestMs: 100 } }); second.hold = true;
  await assert.rejects(timeout.check(randomUUID(), second.publicOrigin, second.key, 'c'.repeat(64), undefined, async () => {}), { code: 'NETWORK' });
  await wait(() => second.stops === 1);
  const third = await fixture(this), socket = await raw(third); third.advance(nativeRuntimeLimits.sessionMs + 1);
  socket.ws.send(JSON.stringify({ id: 'expired', method: 'account/read', params: { refreshToken: false } }));
  assert.equal(await socket.next(), undefined); assert.ok(!third.frames.some(frame => frame.id === 'expired'));
});

Then('native pairing lock disconnect and key removal close transports and preserve host ownership', async function () {
  const f = await fixture(this), v = await vault(f), connection = await v.session.pairNativeRuntime(v.input, v.selection);
  const sibling = await fixture(this), other = broker(this, sibling), siblingId = randomUUID();
  await other.check(siblingId, sibling.publicOrigin, sibling.key, 'c'.repeat(64), undefined, async () => {});
  await v.session.disconnectNativeRuntime(nativeReference(connection)); await wait(() => f.stops === 1);
  assert.equal(other.connected(siblingId), true); assert.equal(sibling.stops, 0);
  await v.session.checkNativeRuntime(nativeReference(connection), v.selection);
  await v.session.remove(null, v.keyId); await wait(() => f.stops === 2);
  assert.deepEqual(await v.session.nativeConnections(), []); assert.ok(!f.frames.some(frame => frame.method === 'account/logout'));
  v.session.lock();
});

Then('native pairing cannot save after cancellation lock or stale schema approval', async function () {
  for (const mode of ['cancel', 'lock', 'schema']) {
    const f = await fixture(this), v = await vault(f), fetch = f.runtime.fetch, controller = new AbortController();
    f.runtime.fetch = async (...args) => {
      const response = await fetch(...args);
      if (mode === 'cancel') controller.abort(); else if (mode === 'lock') v.session.lock(); else v.enabled = false;
      return response;
    };
    await assert.rejects(v.session.pairNativeRuntime(v.input, v.selection, controller.signal));
    assert.equal(f.starts, 0);
    if (mode !== 'lock') assert.deepEqual(await v.session.nativeConnections(), []);
    v.session.lock();
  }
  const f = await fixture(this), v = await vault(f); f.hold = true;
  const pending = v.session.pairNativeRuntime(v.input, v.selection);
  await wait(() => f.release.length === 1); v.session.lock();
  await assert.rejects(pending, { code: 'CANCELLED' }); await wait(() => f.stops === 1);
  await v.session.unlock(v.proof); assert.deepEqual(await v.session.nativeConnections(), []); v.session.lock();
});

Then('native pairings reject credential echoes malformed profiles and untrusted TLS', async function () {
  const f = await fixture(this), v = await vault(f); f.echo = true;
  await assert.rejects(v.session.pairNativeRuntime(v.input, v.selection)); assert.deepEqual(await v.session.nativeConnections(), []);
  f.echo = false; await wait(() => f.stops === f.starts);
  const connection = await v.session.pairNativeRuntime(v.input, v.selection);
  for (const mutate of [value => value.profile = 'other', value => value.host = 'http://127.0.0.1', value => value.identity.version = '0.164.0',
    value => value.pairingKeyId = 'invalid', value => value.revision = 0, value => value.modelFingerprint = 'wrong']) {
    const changed = structuredClone(connection); delete changed.connected; mutate(changed); assert.throws(() => validateNativeConnection(changed));
  }
  v.session.lock();
  const untrusted = new Broker({ requestMs: 1000 }); this.nativeBrokers.push(untrusted);
  await assert.rejects(untrusted.check(randomUUID(), f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {}), { code: 'NETWORK' });
});

Then('the native runtime isolates its home environment configuration and owned child lifecycle', async function () {
  const directory = await mkdtemp(join(tmpdir(), 'operations-owned-native-'));
  const home = join(directory, 'private'), workspace = join(directory, 'workspace'), executable = join(directory, 'codex-fixture');
  const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'native-parent-provider-canary';
  try {
    await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
    const code = `#!${process.execPath}\nimport fs from 'node:fs';\nimport readline from 'node:readline';\nif(process.argv.includes('--version')){console.log('codex-cli 0.163.0');process.exit(0);}\nfs.writeFileSync(process.env.CODEX_HOME+'/observed.json',JSON.stringify({home:process.env.HOME,codexHome:process.env.CODEX_HOME,cwd:process.cwd(),providerKey:!!process.env.OPENAI_API_KEY,args:process.argv.slice(2)}));\nreadline.createInterface({input:process.stdin}).on('line',line=>{const frame=JSON.parse(line);if(frame.id!==undefined)console.log(JSON.stringify({id:frame.id,result:frame.method==='initialize'?{userAgent:'codex/0.163.0'}:{account:null,requiresOpenaiAuth:true}}));});\n`;
    await writeFile(executable, code, { mode: 0o700 });
    const config = { runtimeId: randomUUID(), executable, binarySha256: createHash('sha256').update(code).digest('hex'), home, workspace };
    await assert.rejects(openCodexRuntime({ ...config, home: join(homedir(), '.codex') }));
    await assert.rejects(openCodexRuntime({ ...config, binarySha256: '0'.repeat(64) }));
    const wrongVersion = code.replace('codex-cli 0.163.0', 'codex-cli 0.162.0'), wrongExecutable = join(directory, 'wrong-codex');
    await writeFile(wrongExecutable, wrongVersion, { mode: 0o700 });
    await assert.rejects(openCodexRuntime({ ...config, executable: wrongExecutable, binarySha256: createHash('sha256').update(wrongVersion).digest('hex') }));
    const linked = join(directory, 'linked'); await symlink(home, linked); await assert.rejects(openCodexRuntime({ ...config, home: linked }));
    const runtime = await openCodexRuntime(config), f = await fixture(this, { runtime }), b = broker(this, f);
    const id = randomUUID(); await b.check(id, f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {});
    const observed = JSON.parse(await readFile(join(home, 'observed.json'), 'utf8'));
    assert.equal(observed.home, home); assert.equal(observed.codexHome, home); assert.equal(observed.cwd, workspace); assert.equal(observed.providerKey, false);
    assert.ok(observed.args.includes('cli_auth_credentials_store="file"')); assert.ok(observed.args.includes('sandbox_mode="read-only"'));
    const before = await runtime.authority();
    await writeFile(join(home, 'auth.json'), '{"syntheticAccount":"changed"}', { mode: 0o600 });
    const changed = await runtime.authority(); assert.notEqual(changed.accountEpoch, before.accountEpoch);
    await writeFile(join(home, 'config.toml'), 'test_configuration = true\n');
    assert.notEqual((await runtime.authority()).configuration, before.configuration);
    b.close(id); await f.host.close();
    assert.equal(b.connected(id), false); assert.ok(JSON.parse(await readFile(join(home, 'observed.json'), 'utf8')).args.includes('app-server'));
    await rm(join(home, 'auth.json')); await symlink(join(home, 'observed.json'), join(home, 'auth.json'));
    await assert.rejects(runtime.authority());
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  }
});

// A hostile companion can return frames the trusted host fixture will never emit.
// Exercise the worker's public transport boundary without relaxing host validation.
function scriptedRuntime(world, options = {}) {
  const f = { key: 'K'.repeat(43), host: 'https://native.example.test', now: Date.now(), frames: [], sockets: [], calls: 0,
    identity: { runtimeId: randomUUID(), generation: randomUUID(), accountEpoch: randomUUID(), version: '0.163.0',
      configuration: 'a'.repeat(64), workspace: 'b'.repeat(64) } };
  class Socket extends EventTarget {
    readyState = 0; bufferedAmount = 0;
    constructor() { super(); f.sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    receive(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
    send(text) {
      const frame = JSON.parse(text); f.frames.push(frame);
      if (options.send?.(frame, this, f) === true) return;
      if (frame.type === 'pair') {
        const paired = { type: 'paired', profile: nativeRuntimeProfile, identity: f.identity, scope: f.scope, expiresAt: f.now + 10000 };
        const payload = options.paired ? options.paired(paired) : paired;
        queueMicrotask(() => this.receive(payload));
      } else if (frame.id && frame.method) queueMicrotask(() => this.receive({ id: frame.id,
        result: frame.method === 'account/read' ? { account: null, requiresOpenaiAuth: true } : {} }));
    }
    close() { if (this.readyState !== 3) { this.readyState = 3; this.dispatchEvent(new Event('close')); } }
  }
  f.runtime = { now: () => f.now, requestMs: 80, WebSocket: Socket, fetch: async (_url, init) => {
    f.calls++; f.scope = JSON.parse(init.body).scope;
    if (options.fetch) return options.fetch(f, init);
    return Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + 1000, identity: f.identity });
  } };
  f.broker = broker(world, f);
  f.check = (id = randomUUID(), signal, guard = async () => {}) => f.broker.check(id, f.host, f.key, 'c'.repeat(64), undefined, guard, signal);
  f.agent = (id = randomUUID(), events = { frame: () => false, closed() {} }, guard = async () => {}) =>
    f.broker.agent(id, f.host, f.key, 'c'.repeat(64), f.identity, guard, events);
  return f;
}

Then('native ticket parsing rejects malformed opaque and oversized responses before opening sockets', async function () {
  const responses = [
    () => new Response(null, { status: 403 }), () => new Response(null, { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ padding: 'x'.repeat(8192) }),
    f => Response.json({ ticket: 'short', expiresAt: f.now + 1000, identity: f.identity }),
    f => Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now, identity: f.identity }),
    f => Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + nativeRuntimeLimits.ticketMs + 1, identity: f.identity }),
    f => Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + 1000, identity: { ...f.identity, version: '0.164.0' } }),
  ];
  for (const fetch of responses) {
    const f = scriptedRuntime(this, { fetch }); await assert.rejects(f.check(), { code: 'AUTHORIZATION' }); assert.equal(f.sockets.length, 0);
  }
  const opaque = scriptedRuntime(this, { fetch() { throw new Error('private upstream detail'); } });
  await assert.rejects(opaque.check(), error => error.code === 'NETWORK' && !error.message.includes('private upstream'));
  const f = scriptedRuntime(this), cancel = new AbortController(); cancel.abort();
  await assert.rejects(f.check(randomUUID(), cancel.signal), { code: 'CANCELLED' });
  await assert.rejects(f.broker.check(randomUUID(), f.host, 'bad', 'c'.repeat(64), undefined, async () => {}), { code: 'INVALID' });
  assert.equal(f.calls, 0);
});

Then('native pairing rejects forged scope expiry and malformed socket messages and closes the peer', async function () {
  for (const paired of [
    value => ({ ...value, profile: 'unreviewed' }), value => ({ ...value, type: 'result' }),
    value => ({ ...value, identity: { ...value.identity, workspace: 'd'.repeat(64) } }),
    value => ({ ...value, scope: { ...value.scope, connectionId: randomUUID() } }),
    value => ({ ...value, scope: { ...value.scope, method: 'codex-workflow' } }),
    value => ({ ...value, scope: { ...value.scope, fingerprint: 'd'.repeat(64) } }),
    value => ({ ...value, expiresAt: 0 }), value => ({ ...value, expiresAt: Date.now() + nativeRuntimeLimits.sessionMs + 10000 }),
    () => '{', () => 'K'.repeat(43), () => 'x'.repeat(nativeRuntimeLimits.frame + 1),
  ]) {
    const f = scriptedRuntime(this, { paired }); await assert.rejects(f.check(), { code: 'AUTHORIZATION' });
    assert.equal(f.sockets[0].readyState, 3); assert.equal(f.frames.some(frame => frame.method === 'initialize'), false);
  }
  assert.throws(() => nativeScope({ connectionId: randomUUID(), method: 'account/read', fingerprint: 123 }));
});

Then('native broker limits concurrent owners and requests and revokes expired or disconnected work', async function () {
  const f = scriptedRuntime(this), id = randomUUID();
  const first = f.check(id); await assert.rejects(f.check(id), { code: 'CONFLICT' }); await first;
  assert.equal((await f.check(id)).accountType, 'none'); assert.equal(f.calls, 1, 'A current owner reuses its transport.');
  for (let index = 0; index < 3; index++) await f.check();
  await assert.rejects(f.check(), { code: 'LIMIT' }); await assert.rejects(f.agent(), { code: 'LIMIT' });
  f.broker.clear(); assert.ok(f.sockets.every(socket => socket.readyState === 3));
  const pending = scriptedRuntime(this, { send: frame => frame.method === 'thread/start' }), owner = randomUUID(), peer = await pending.agent(owner);
  assert.equal(await pending.agent(owner), peer, 'A workflow owner reuses matching authority.');
  const requests = Array.from({ length: nativeRuntimeLimits.pending }, () => peer.request('thread/start', {}));
  const failures = requests.map(request => assert.rejects(request, { code: 'NETWORK' }));
  await assert.rejects(peer.request('thread/start', {}), { code: 'LIMIT' }); pending.broker.close(owner); await Promise.all(failures);
  assert.equal(pending.broker.connected(owner), false);
  const expired = scriptedRuntime(this), expiredPeer = await expired.agent(); expired.now = expiredPeer.expiresAt;
  await assert.rejects(expiredPeer.request('thread/start', {}), { code: 'AUTHORIZATION' }); assert.equal(expiredPeer.socket.readyState, 3);
  const cancelled = scriptedRuntime(this), cancelledPeer = await cancelled.agent(), cancel = new AbortController(); cancel.abort();
  await assert.rejects(cancelledPeer.request('thread/start', {}, cancel.signal), { code: 'CANCELLED' });
});

Then('native broker rejects malformed account results and converts socket failures without leaking details', async function () {
  for (const result of [null, [], {}, { requiresOpenaiAuth: 'yes', account: null },
    { requiresOpenaiAuth: true, account: [] }, { requiresOpenaiAuth: true, account: { type: 'foreign' } }]) {
    const f = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'account/read') return false;
      queueMicrotask(() => socket.receive({ id: frame.id, result })); return true; } });
    await assert.rejects(f.check(), { code: 'AUTHORIZATION' }); assert.equal(f.sockets[0].readyState, 3);
  }
  const optional = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'account/read') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, result: { requiresOpenaiAuth: true } })); return true; } });
  await assert.doesNotReject(optional.check(), 'The pinned native account metadata may omit an absent account.');
  const rpcError = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'thread/start') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private upstream detail' } })); return true; } });
  const peer = await rpcError.agent(); await assert.rejects(peer.request('thread/start', {}), error => error.code === 'NATIVE_FAILED' && !error.message.includes('private upstream'));
  peer.socket.bufferedAmount = nativeRuntimeLimits.frame + 1;
  await assert.rejects(peer.request('thread/start', {}), { code: 'NETWORK' });
  const opaque = scriptedRuntime(this); let guards = 0;
  await assert.rejects(opaque.check(randomUUID(), undefined, async () => { if (++guards === 4) throw new Error('private guard detail'); }),
    error => error.code === 'NETWORK' && !error.message.includes('private guard'));
});

Then('native stalled pairing retries only tickets while malformed live frames revoke owned work', async function () {
  const retry = scriptedRuntime(this, { fetch: f => f.calls === 1 ? new Response(null, { status: 409 })
    : Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + 1000, identity: f.identity }) });
  retry.runtime.requestMs = 500; await retry.agent(); assert.equal(retry.calls, 2);
  assert.equal(retry.frames.filter(frame => frame.method === 'initialize').length, 1);
  const stalled = scriptedRuntime(this, { send: frame => frame.type === 'pair' });
  // The shared request deadline aborts the handshake before its socket timer.
  await assert.rejects(stalled.check(), { code: 'CANCELLED' }); assert.equal(stalled.sockets[0].readyState, 3);
  const cancel = new AbortController(), cancelled = scriptedRuntime(this, { send: frame => frame.type === 'pair' });
  const opening = cancelled.check(randomUUID(), cancel.signal), rejected = assert.rejects(opening, { code: 'CANCELLED' });
  await wait(() => cancelled.sockets.length); cancel.abort(); await rejected;
  const fetching = scriptedRuntime(this, { fetch: (_f, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('closed while opening')), { once: true });
  }) });
  const work = fetching.check(), closed = assert.rejects(work, { code: 'CANCELLED' });
  await wait(() => fetching.calls); fetching.broker.clear(); await closed; assert.deepEqual(fetching.sockets, []);
  for (const payload of ['binary', 'ambiguous', 'foreign', 'notification', 'expired', 'huge']) {
    const f = scriptedRuntime(this, { send: frame => frame.method === 'thread/start' }), peer = await f.agent();
    const result = peer.request('thread/start', {}), failure = assert.rejects(result, { code: 'NETWORK' });
    await wait(() => f.frames.some(frame => frame.method === 'thread/start'));
    const id = f.frames.find(frame => frame.method === 'thread/start').id;
    if (payload === 'binary') peer.socket.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([1]) }));
    else if (payload === 'ambiguous') peer.socket.receive({ id, result: {}, error: {} });
    else if (payload === 'foreign') peer.socket.receive({ id: 'foreign', result: {} });
    else if (payload === 'notification') peer.socket.receive({ method: 'foreign', params: {} });
    else if (payload === 'huge') peer.socket.receive('x'.repeat(nativeRuntimeLimits.frame + 1));
    else { f.now = peer.expiresAt; peer.socket.receive({ id, result: {} }); }
    await failure; assert.equal(peer.socket.readyState, 3);
  }
  const failed = scriptedRuntime(this, { send(frame) { if (frame.type === 'pair') throw new Error('socket unavailable'); } });
  await assert.rejects(failed.check(), { code: 'AUTHORIZATION' });
});

Then('native saved authority rejects malformed bindings duplicate owners and removed profiles', async function () {
  const f = await fixture(this), v = await vault(f);
  try {
    await assert.rejects(v.session.pairNativeRuntime({ ...v.input, pairingKeyId: randomUUID() }, v.selection), { code: 'PERMISSION' });
    const saved = await v.session.pairNativeRuntime(v.input, v.selection), { connected: _connected, ...connection } = saved;
    for (const binding of [{ runtime: nativeReference(connection), fingerprint: 1 }, { runtime: nativeReference(connection), fingerprint: 'bad' },
      { runtime: { ...nativeReference(connection), revision: 0 }, fingerprint: 'a'.repeat(64) }]) assert.throws(() => validateNativeBinding(binding), { code: 'INVALID' });
    assert.deepEqual(validateNativeBinding({ runtime: nativeReference(connection), fingerprint: 'a'.repeat(64) }).runtime, nativeReference(connection));
    assert.throws(() => storedNativeConnections([{ id: randomUUID(), nativeConnections: [connection] }]), { code: 'INVALID' });
    assert.throws(() => storedNativeConnections([{ id: v.keyId, nativeConnections: [connection, connection] }]), { code: 'LIMIT' });
    await assert.rejects(v.session.disconnectNativeRuntime(nativeReference(connection), 'yes'), { code: 'INVALID' });
    await assert.rejects(v.session.disconnectNativeRuntime({ ...nativeReference(connection), revision: 2 }), { code: 'CONFLICT' });
    f.account = { type: 'apiKey' }; await assert.rejects(v.session.checkNativeRuntime(nativeReference(connection), v.selection), { code: 'AUTHORIZATION' });
    assert.deepEqual(await v.session.disconnectNativeRuntime(nativeReference(connection), true), []);
    await assert.rejects(v.session.checkNativeRuntime(nativeReference(connection), v.selection), { code: 'CONFLICT' });
  } finally { v.session.lock(); }
});

async function rewriteNativeRecord(v, snapshot, mutate) {
  v.session.lock();
  const context = item => ({ vaultId: snapshot.id, epoch: snapshot.epoch, kind: item.kind, id: item.id, revision: item.revision });
  const envelope = snapshot.envelopes.find(item => item.id === v.proof.methodId);
  const key = await unwrapVaultKey(envelope.wrappedKey, await recoveryKey(v.proof.secret, envelope.salt), context(envelope));
  const values = await Promise.all(snapshot.records.map(record => decryptJSON(key, record.ciphertext, context(record))));
  await mutate(values);
  const records = await Promise.all(snapshot.records.map(async (record, index) => ({ ...record, ciphertext: await encryptJSON(key, values[index], context(record)) })));
  v.storage.state.snapshot = await sealSnapshot({ id: snapshot.id, epoch: snapshot.epoch, revision: snapshot.revision, envelopes: snapshot.envelopes, records }, key);
  v.storage.state.revision++; v.storage.state.lockEpoch++;
  v.session = v.newSession(); await v.session.unlock(v.proof); return values;
}

Then('native encrypted records reject malformed collections altered fingerprints and excessive saved authority', async function () {
  const f = await fixture(this), v = await vault(f);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection), selections = await v.workflowSelections();
    await v.session.enableNativeWorkflow(nativeReference(paired), selections);
    const snapshot = structuredClone(v.storage.state.snapshot);
    for (const mutate of [owner => owner.nativeConnections = {}, owner => owner.nativeConnections = Array(33).fill(owner.nativeConnections[0]),
      owner => owner.nativeConnections.push(owner.nativeConnections[0])]) {
      await rewriteNativeRecord(v, snapshot, values => mutate(values.find(value => value.id === v.keyId)));
      await assert.rejects(v.session.nativeConnections(), { code: 'LIMIT' });
    }
    await rewriteNativeRecord(v, snapshot, values => values.find(value => value.id === v.keyId).nativeConnections[0].pairingKeyId = randomUUID());
    await assert.rejects(v.session.nativeConnections(), { code: 'INVALID' });
    for (const mutate of [owner => owner.value = 'R'.repeat(43), owner => owner.nativeConnections[0].keyHash = 'd'.repeat(64),
      owner => owner.nativeConnections[0].modelFingerprint = 'd'.repeat(64), owner => owner.nativeConnections[0].fingerprint = 'd'.repeat(64)]) {
      const values = await rewriteNativeRecord(v, snapshot, records => mutate(records.find(value => value.id === v.keyId)));
      const connection = values.find(value => value.id === v.keyId).nativeConnections[0], reference = nativeReference(connection), before = f.requests.length;
      await assert.rejects(v.session.checkNativeRuntime(reference, v.selection), { code: 'AUTHORIZATION' });
      await assert.rejects(v.session.enableNativeWorkflow(reference, selections), { code: 'AUTHORIZATION' });
      assert.equal(f.requests.length, before, 'Altered encrypted authority cannot create a ticket.');
    }
    await rewriteNativeRecord(v, snapshot, values => {
      const owner = values.find(value => value.id === v.keyId), connection = owner.nativeConnections[0];
      owner.nativeConnections = Array.from({ length: 32 }, () => ({ ...connection, id: randomUUID() }));
    });
    await assert.rejects(v.session.pairNativeRuntime(v.input, v.selection), { code: 'LIMIT' });
    const other = await v.workflowSelections();
    await assert.rejects(v.session.pairNativeRuntime(v.input, other.find(value => value.operation.rpc.method === 'thread/start')), { code: 'PERMISSION' });
  } finally { v.session.lock(); }
});

Then('native runtime defaults retain TLS trust and changed peer authority forces a fresh check', async function () {
  const host = await fixture(this), defaults = new NativeRuntimeBroker({ fetch: host.fetch, WebSocket: host.Socket }); this.nativeBrokers.push(defaults);
  const id = randomUUID(); await defaults.check(id, host.publicOrigin, host.key, 'c'.repeat(64), undefined, async () => {});
  assert.equal(defaults.connected(id), true); defaults.close(id); await wait(() => host.stops === host.starts);
  const untrusted = new NativeRuntimeBroker({ fetch: host.fetch, requestMs: 300 }); this.nativeBrokers.push(untrusted);
  const before = host.starts; await assert.rejects(untrusted.check(randomUUID(), host.publicOrigin, host.key, 'c'.repeat(64), undefined, async () => {}));
  assert.equal(host.starts, before, 'Default browser sockets cannot bypass TLS and Origin checks.');
  const f = scriptedRuntime(this), owner = randomUUID(); await f.check(owner);
  await f.broker.check(owner, f.host, f.key, 'd'.repeat(64), undefined, async () => {});
  assert.equal(f.calls, 2); assert.equal(f.sockets[0].readyState, 3);
  f.key = 'Q'.repeat(43); await f.check(owner); assert.equal(f.calls, 3);
  f.identity.workspace = 'd'.repeat(64);
  await f.broker.check(owner, f.host, f.key, 'c'.repeat(64), f.identity, async () => {});
  assert.equal(f.calls, 4); assert.equal(f.broker.connected(owner), true);
  const foreign = scriptedRuntime(this);
  await assert.rejects(foreign.broker.agent(randomUUID(), foreign.host, foreign.key, 'c'.repeat(64), { ...foreign.identity, workspace: 'd'.repeat(64) },
    async () => {}, { frame: () => true, closed() {} }), { code: 'AUTHORIZATION' }); assert.deepEqual(foreign.sockets, []);
  const authority = scriptedRuntime(this), peer = await authority.agent(randomUUID(), { frame: () => true, closed() {} });
  peer.socket.receive({ type: 'authority', identity: { ...authority.identity, workspace: 'd'.repeat(64) } });
  assert.equal(peer.socket.readyState, 3, 'A consumer cannot accept changes to pinned runtime authority.');
});

Then('native cancellation and disconnect during asynchronous guards cannot publish a paired peer', async function () {
  for (const phase of [2, 3]) for (const mode of ['cancel', 'deadline', 'disconnect']) {
    if (phase === 2 && mode === 'disconnect') continue;
    const f = scriptedRuntime(this), cancel = new AbortController(); let calls = 0;
    await assert.rejects(f.check(randomUUID(), cancel.signal, async () => {
      if (++calls !== phase) return;
      if (mode === 'cancel') cancel.abort();
      else if (mode === 'disconnect') f.sockets[0].close();
      else await new Promise(resolve => setTimeout(resolve, 100));
    }), { code: mode === 'cancel' ? 'CANCELLED' : 'NETWORK' });
    assert.ok(f.sockets.every(socket => socket.readyState === 3));
  }
  const error = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'initialize') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private initialization detail' } })); return true; } });
  await assert.rejects(error.agent(), { code: 'NATIVE_FAILED' }); assert.equal(error.sockets[0].readyState, 3);
  const checking = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'account/read') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private account detail' } })); return true; } });
  await assert.rejects(checking.check(), { code: 'AUTHORIZATION' });
  const opening = scriptedRuntime(this, { fetch: (_f, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('closed during initialization')), { once: true });
  }) });
  const run = opening.agent(), failed = assert.rejects(run, { code: 'CANCELLED' });
  await wait(() => opening.calls); opening.broker.clear(); await failed; assert.deepEqual(opening.sockets, []);
});

Then('native handshake expiry closes an unacknowledged socket before the overall request deadline', { timeout: 10000 }, async function () {
  const f = scriptedRuntime(this, { send: frame => frame.type === 'pair' }); f.runtime.requestMs = 10000;
  await assert.rejects(f.check(), { code: 'NETWORK' }); assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.frames.some(frame => frame.method === 'initialize'), false);
});

Then('native query results enforce declared scalar collection and reference constraints without coercion', function () {
  const valid = [
    [1.25, { type: 'number', minimum: 1, maximum: 2 }],
    [true, { type: ['string', 'boolean'] }],
    ['λ', { type: 'string', minLength: 1, maxLength: 1, enum: ['λ'], const: 'λ' }],
    [[1], { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 1 }],
    [{ first: 'owned' }, { type: 'object', minProperties: 1, maxProperties: 1, additionalProperties: { type: 'string' } }],
  ];
  for (const [value, schema] of valid) assert.deepEqual(validateNativeQueryResult(value, schema, {}), value);
  const invalid = [
    [1, { type: 'string' }], [true, { type: 'number' }], [Infinity, { type: 'number' }],
    ['λ', { type: 'string', minLength: 2 }], ['λλ', { type: 'string', maxLength: 1 }], ['\ud800', { type: 'string' }],
    [0, { type: 'number', minimum: 1 }], [2, { type: 'number', maximum: 1 }],
    [1.5, { type: 'number', format: 'int64' }], [-1, { type: 'number', format: 'uint64' }], [0x100000000, { type: 'number', format: 'uint32' }],
    ['unlisted', { type: 'string', enum: ['owned'] }], ['owned', { type: 'string', enum: 'owned' }],
    ['other', { const: 'owned' }], [[], { enum: [] }],
    [[], { type: 'array', items: { type: 'integer' }, minItems: 1 }],
    [[1, 2], { type: 'array', items: { type: 'integer' }, maxItems: 1 }], [[1], { type: 'array' }],
    [{}, { type: 'object', minProperties: 1 }], [{ a: 1 }, { type: 'object', maxProperties: 0 }],
    [1, {}], [1, { anyOf: [] }], [1, { oneOf: true }], [1, { allOf: Array(33).fill({ type: 'integer' }) }],
    [1, { allOf: [{ type: 'integer' }, { type: 'string' }] }],
    [1, { $ref: 1 }], [1, { $ref: 'https://untrusted.test/schema' }], [1, { $ref: '#/definitions/a~2b' }],
  ];
  for (const [value, schema] of invalid) assert.throws(() => validateNativeQueryResult(value, schema, {}), { code: 'NATIVE_CONTRACT' });
  const document = { definitions: { 'a/b': { 't~n': { type: 'integer' } }, scalar: false } };
  assert.equal(validateNativeQueryResult(7, { $ref: '#/definitions/a~1b/t~0n' }, document), 7);
  for (const ref of ['#/definitions/missing', '#/definitions/scalar/child'])
    assert.throws(() => validateNativeQueryResult(7, { $ref: ref }, document), { code: 'NATIVE_CONTRACT' });
});

Then('native query JSON allowances retain UTF-8 shape node and nesting limits', function () {
  const source = { text: 'λ', list: [null, true, 1.25], nested: { value: 'owned' } };
  for (const schema of [true, {}]) {
    const cloned = validateNativeQueryResult(source, schema, {}, true);
    assert.deepEqual(cloned, source); assert.notEqual(cloned, source); assert.notEqual(cloned.nested, source.nested);
    for (const value of [{ '\ud800': 'invalid key' }, { bad: undefined }, { bad: '\ud800' }])
      assert.throws(() => validateNativeQueryResult(value, schema, {}, true), { code: 'NATIVE_CONTRACT' });
  }
  assert.throws(() => validateNativeQueryResult('x'.repeat(nativeRuntimeLimits.frame), { type: 'string' }, {}), { code: 'LIMIT' });
  let deep = null;
  for (let level = 0; level < 49; level++) deep = [deep];
  assert.throws(() => validateNativeQueryResult(deep, true, {}, true), { code: 'LIMIT' });
  assert.throws(() => validateNativeQueryResult(Array(16_384).fill(0), true, {}, true), { code: 'LIMIT' });
  assert.throws(() => validateNativeQueryResult(Array(16_384).fill(0), { type: 'array', items: { type: 'integer' } }, {}), { code: 'LIMIT' });
  const recursive = { definitions: { loop: { $ref: '#/definitions/loop' } } };
  assert.throws(() => validateNativeQueryResult(0, recursive.definitions.loop, recursive), { code: 'LIMIT' });
  assert.throws(() => validateNativeQueryResult(0, { anyOf: [recursive.definitions.loop, { type: 'integer' }] }, recursive), { code: 'LIMIT' });
});

Then('native query metadata faults are reduced to the public contract error', function () {
  const malformed = { definitions: {} };
  Object.defineProperty(malformed.definitions, 'broken', { get() { throw new Error('private metadata details'); } });
  for (const schema of [{ $ref: '#/definitions/broken' }, { anyOf: [{ $ref: '#/definitions/broken' }] }])
    assert.throws(() => validateNativeQueryResult(1, schema, malformed), error => error.code === 'NATIVE_CONTRACT' && !error.message.includes('private metadata'));
  const declared = [1, 2];
  assert.deepEqual(validateNativeQueryResult(declared, { enum: [declared] }, {}), declared);
});

function scopedRuntimeCall(f, kind, id, guard = async () => {}, signal, key = f.key, fingerprint = 'c'.repeat(64), expected = f.identity) {
  const args = [id, f.host, key, fingerprint, expected], events = { frame: () => true, closed() {} };
  if (kind === 'initialize') return f.broker.initialize(...args, nativeInitializeParams(), guard, signal);
  if (kind === 'query') return f.broker.query(...args, 'model/list', {}, guard, signal);
  if (kind === 'mcp') return f.broker.mcpOAuth(...args, { name: 'owned' }, guard, signal);
  if (kind === 'feedback') return f.broker.feedback(...args, {}, guard, signal);
  return f.broker[kind === 'watch' ? 'watchChannel' : 'commandChannel'](...args, guard, events);
}

Then('native scoped transports retain concurrent opening ownership and the shared four owner cap', async function () {
  const held = scriptedRuntime(this, { fetch: (_f, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('closed controlled ticket')), { once: true })) });
  held.runtime.requestMs = 5000;
  const owner = randomUUID(), pending = held.check(owner), rejected = assert.rejects(pending, { code: 'CANCELLED' }); await wait(() => held.calls === 1);
  for (const kind of ['initialize', 'query', 'mcp', 'feedback', 'watch', 'command']) await assert.rejects(scopedRuntimeCall(held, kind, owner), { code: 'CONFLICT' }, kind);
  held.broker.clear(); await rejected;
  const full = scriptedRuntime(this);
  for (let index = 0; index < 4; index++) await full.check();
  for (const kind of ['initialize', 'query', 'mcp', 'feedback', 'watch', 'command']) await assert.rejects(scopedRuntimeCall(full, kind, randomUUID()), { code: 'LIMIT' }, kind);
  assert.equal(full.calls, 4, 'Rejected owners cannot request extra tickets.');
});

Then('native command and watch channels reuse only exact current authority and preserve owner conflicts', async function () {
  for (const kind of ['watch', 'command']) for (const mode of ['same', 'key', 'fingerprint', 'expired', 'identity']) {
    const f = scriptedRuntime(this), owner = randomUUID(), peer = await scopedRuntimeCall(f, kind, owner);
    if (mode === 'expired') f.now = peer.expiresAt;
    const call = scopedRuntimeCall(f, kind, owner, async () => {}, undefined, mode === 'key' ? 'J'.repeat(43) : f.key,
      mode === 'fingerprint' ? 'd'.repeat(64) : 'c'.repeat(64), mode === 'identity' ? { ...f.identity, workspace: 'e'.repeat(64) } : f.identity);
    if (mode === 'identity') await assert.rejects(call, { code: kind === 'watch' ? 'NATIVE_FILESYSTEM' : 'NATIVE_COMMAND' });
    else { const next = await call; assert.equal(next === peer, mode === 'same'); }
    assert.equal(f.calls, mode === 'same' ? 1 : 2);
  }
  const busy = scriptedRuntime(this), owner = randomUUID(); await busy.agent(owner);
  await assert.rejects(scopedRuntimeCall(busy, 'watch', owner), { code: 'CONFLICT' });
  await assert.rejects(scopedRuntimeCall(busy, 'command', owner), { code: 'CONFLICT' });
  for (const kind of ['watch', 'command']) {
    const f = scriptedRuntime(this); await assert.rejects(scopedRuntimeCall(f, kind, randomUUID(), async () => { throw new VaultError('LIMIT'); }), { code: 'LIMIT' });
    assert.deepEqual(f.sockets, []);
  }
});

Then('native peer request identities remain unique and specialized deadlines retain their defaults', async function () {
  const f = scriptedRuntime(this, { send: frame => frame.method === 'thread/start' }), peer = await f.agent();
  await assert.rejects(peer.request('thread/start', {}, undefined, 'invalid/id'), { code: 'INVALID' });
  const pending = peer.request('thread/start', {}, undefined, 'owned'), rejected = assert.rejects(pending, { code: 'NETWORK' });
  await wait(() => f.frames.some(frame => frame.id === 'owned'));
  await assert.rejects(peer.request('thread/start', {}, undefined, 'owned'), { code: 'INVALID' }); peer.close(); await rejected;
  const defaults = scriptedRuntime(this), current = await defaults.agent(); delete defaults.runtime.requestMs;
  for (const method of ['account/rateLimitResetCredit/consume', 'command/exec', 'thread/shellCommand', 'account/gatewayOAuth/login',
    'externalAgentConfig/import', 'mcpServer/oauth/login', 'mcpServer/tool/call', 'feedback/upload', 'model/list'])
    await current.request(method, {});
  const failedImport = scriptedRuntime(this, { send(frame, socket) {
    if (frame.method !== 'externalAgentConfig/import') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private native failure' } })); return true;
  } });
  const importing = await failedImport.agent(); await assert.rejects(importing.request('externalAgentConfig/import', {}), { code: 'NATIVE_MIGRATION' });
});

Then('native scoped error mapping retains cancellation when a transport guard fails during abort', async function () {
  for (const kind of ['query', 'mcp', 'feedback']) {
    const f = scriptedRuntime(this), controller = new AbortController();
    await assert.rejects(scopedRuntimeCall(f, kind, randomUUID(), async () => { controller.abort(); throw new VaultError('NETWORK'); }, controller.signal), { code: 'CANCELLED' });
    assert.deepEqual(f.sockets, []);
  }
  for (const [method, code] of [['threadSection/create', 'NATIVE_SECTIONS'], ['fs/writeFile', 'NATIVE_FILESYSTEM']]) {
    const f = scriptedRuntime(this);
    await assert.rejects(f.broker.query(randomUUID(), f.host, f.key, 'c'.repeat(64), f.identity, method, {}, async () => { throw new VaultError('NETWORK'); }), { code });
  }
});

Then('late native opening failures cannot remove a newer paired owner or its transport', async function () {
  for (const kind of ['agent', 'account', 'initialize', 'query', 'mcp', 'watch', 'command']) {
    let release, entered = false;
    const gate = new Promise(resolve => { release = resolve; }), f = scriptedRuntime(this), owner = randomUUID();
    const guard = async () => { entered = true; await gate; throw new VaultError('LIMIT'); };
    const opening = kind === 'agent' ? f.agent(owner, undefined, guard) : kind === 'account' ? f.check(owner, undefined, guard) : scopedRuntimeCall(f, kind, owner, guard);
    const rejected = assert.rejects(opening, { code: 'LIMIT' }); await wait(() => entered);
    f.broker.close(owner); assert.equal((await f.check(owner)).accountType, 'none');
    release(); await rejected;
    assert.equal(f.broker.connected(owner), true, kind + ' discarded the replacement owner.');
    assert.equal(f.sockets[0].readyState, 1); assert.equal((await f.check(owner)).accountType, 'none'); assert.equal(f.calls, 1);
  }
});

Then('native scoped failures retain MCP login and feedback diagnostic codes', async function () {
  const oauth = scriptedRuntime(this, { send(frame, socket) {
    if (frame.method !== 'mcpServer/oauth/login') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private sign-in failure' } })); return true;
  } });
  const peer = await oauth.agent(); await assert.rejects(peer.request('mcpServer/oauth/login', {}), { code: 'NATIVE_MCP_OAUTH' });
  const feedback = scriptedRuntime(this);
  await assert.rejects(scopedRuntimeCall(feedback, 'feedback', randomUUID(), async () => { throw new VaultError('NETWORK'); }), { code: 'NATIVE_FEEDBACK' });
});

Then('a rejected native agent ticket leaves no owned peer or initialized socket', async function () {
  const f = scriptedRuntime(this, { fetch: () => new Response(null, { status: 403 }) }), owner = randomUUID();
  await assert.rejects(f.agent(owner), { code: 'AUTHORIZATION' });
  assert.equal(f.broker.connected(owner), false); assert.deepEqual(f.sockets, []); assert.deepEqual(f.frames, []); assert.equal(f.calls, 1);
});
