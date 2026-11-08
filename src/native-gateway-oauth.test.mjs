// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeGatewayOAuthParams } from './lib/native-gateway-oauth.ts';
import { nativeAccountSdkFixture } from '../tests/native-account-read-sdk.fixture.mjs';
import { seedNativeGateway, nativeGatewayFixture } from '../tests/native-gateway-oauth.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { nativeAccountAuthority } from '../companions/codex/account-authority.mjs';
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { canStartVaultRequest } from './lib/secrets/request-policy.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';

Before({ tags: '@native-gateway-oauth' }, function () { this.gatewayFixtures = []; });
After({ tags: '@native-gateway-oauth' }, async function () { for (const c of this.gatewayFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeGatewayFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.gatewayFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (signal, progress) => v.session.executeNativeRuntime(c.reference, c.selections, c.select('account/gatewayOAuth/login'), {}, signal, progress, next => c.reference = next);
  c.cancel = () => v.session.cancelNativeGatewayLogin(c.reference, c.selections, c.select('account/gatewayOAuth/cancel'), {});
  return c;
}

Then('gateway action inputs retain empty native params and name overrides', function () {
  assert.deepEqual(nativeGatewayOAuthParams({}), {}); assert.deepEqual(nativeGatewayOAuthParams(null), {});
  for (const field of ['accessToken', 'authorizationUrl', 'providerId', 'loginId']) assert.throws(() => nativeGatewayOAuthParams({ [field]: 'unavailable' }), error => error.field === field);
});
Then('gateway operation models preserve their scoped native wire contracts', async function () {
  const source = await readServiceSchema('codex');
  for (const method of ['account/gatewayOAuth/login', 'account/gatewayOAuth/cancel']) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.equal(operation.protocol, 'json-rpc'); assert.deepEqual(operation.fields, []);
    assert.deepEqual(prepareNativeRequest(operation, {}).params, {}); assert.deepEqual(scopeNativeRpcSchema(document, method), document);
    assert.deepEqual(document['x-operations-native-workflow'].wireConfirmation, { $ref: '#/definitions/v2/GatewayOAuthReadResponse' });
    assert.deepEqual(document['x-operations-native-workflow'].wireNotifications, [{ $ref: '#/definitions/v2/GatewayOAuthChangedNotification' }]);
  }
});
Then('native initialization prevents implicit gateway authentication', function () {
  const expected = { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false, explicitGatewayOauth: true } };
  assert.deepEqual(nativeInitializeParams(), expected);
  assert.deepEqual(nativeInitializeParams({ ...expected, capabilities: { experimentalApi: false } }), expected);
  assert.deepEqual(nativeInitializeParams(expected), expected);
  for (const value of [false, null, 'true', 1]) assert.throws(() => nativeInitializeParams({ ...expected, capabilities: { ...expected.capabilities, explicitGatewayOauth: value } }));
});
Then('gateway workflows adopt only an owned confirmed secondary credential transition', async function () {
  const c = await setup(this), before = c.reference; let notice, settled = false;
  const pending = c.execute(undefined, value => { notice = value; }); void pending.then(() => { settled = true; }, () => {});
  await waitForWatch(() => notice?.kind === 'gateway-login'); assert.equal(settled, false); assert.equal(notice.providerId, 'owned_gateway');
  c.f.finishGateway(); const result = await pending; assert.deepEqual(result.response.result, {}); assert.equal(c.reference.revision, before.revision + 1);
  assert.equal(JSON.stringify(result).includes('authUrl'), false); assert.equal(JSON.stringify(c.v.storage.state).includes(notice.authUrl), false);
  assert.equal((await c.v.session.nativeConnections())[0].accountType, 'none');
  assert.deepEqual((await c.cancel()).response.result, {});
});
Then('gateway cancellation releases its owner before rejecting the pending login', async function () {
  assert.equal(canStartVaultRequest(['executeNativeRuntime'], 'cancelNativeGatewayLogin'), true);
  assert.equal(canStartVaultRequest(['executeNativeRuntime', 'cancelNativeGatewayLogin'], 'cancelNativeGatewayLogin'), false);
  for (const errorFirst of [true, false]) {
    const c = await setup(this, { errorFirst }), before = c.reference;
    for (let attempt = 0; attempt < 2; attempt++) {
      let notice; const pending = c.execute(undefined, value => { notice = value; }); void pending.catch(() => {});
      await waitForWatch(() => notice?.kind === 'gateway-login'); assert.deepEqual((await c.cancel()).response.result, {});
      await assert.rejects(pending, error => error.code === 'CANCELLED'); assert.deepEqual(c.reference, before);
      await waitForWatch(() => c.f.starts === c.f.stops);
    }
  }
});
Then('gateway workflows reject missing grants foreign handoffs and changed primary authority', async function () {
  const denied = await setup(this, { allowGatewayOAuth: false }); await assert.rejects(denied.execute());
  assert.equal(denied.f.frames.some(frame => frame.method === 'account/gatewayOAuth/login'), false);
  const foreign = await setup(this, { onFrame(frame, f, emit) {
    if (frame.method !== 'account/gatewayOAuth/login') return false;
    emit({ method: 'account/gatewayOAuth/changed', params: { providerId: 'foreign', status: 'started', authUrl: 'https://other.example.test/authorize', error: null } }); return true;
  } }); await assert.rejects(foreign.execute());
  const c = await setup(this), before = c.reference; let notice;
  const pending = c.execute(undefined, value => { notice = value; }); void pending.catch(() => {});
  await waitForWatch(() => notice?.kind === 'gateway-login'); c.f.primaryEpoch++; c.f.finishGateway();
  await assert.rejects(pending); assert.deepEqual(c.reference, before);
});
Then('the actual SDK gateway controls retain their private workflow owner', { timeout: 45000 }, async function () {
  const c = await setup(this, { real: true }), before = c.reference;
  for (let attempt = 0; attempt < 2; attempt++) {
    let notice, failure; const pending = c.execute(undefined, value => { notice = value; }); void pending.catch(error => { failure = error; });
    await waitForWatch(() => notice?.kind === 'gateway-login' || failure); assert.equal(failure?.code, undefined, JSON.stringify({ diagnostics: c.f.gatewayDiagnostics, methods: c.f.frames.map(frame => frame.method), starts: c.f.starts, stops: c.f.stops }));
    assert.equal(new URL(notice.authUrl).origin, c.f.backend.origin);
    assert.deepEqual((await c.cancel()).response.result, {}); await assert.rejects(pending, error => error.code === 'CANCELLED');
    await waitForWatch(() => c.f.starts === c.f.stops);
    assert.deepEqual(c.reference, before);
  }
  assert.equal(c.f.backend.requests.length, 0);
});
Then('native credential snapshots track both encrypted stores and reject aliases', async function () {
  const home = await mkdtemp(join(tmpdir(), 'operations-gateway-authority-')), uid = process.getuid();
  const directory = join(home, 'secrets'), gateway = join(directory, 'gateway_oauth.age'), codex = join(directory, 'codex_auth.age');
  const capture = () => nativeAccountAuthority(home, uid);
  try {
    const empty = await capture(); assert.deepEqual(empty, { auth: 'absent', codex: 'absent', gateway: 'absent' });
    await mkdir(directory, { mode: 0o755 }); await writeFile(join(directory, 'gateway_oauth.lock'), 'owned fixture lock');
    assert.deepEqual(await capture(), empty);
    await writeFile(gateway, 'owned encrypted gateway fixture', { mode: 0o600 });
    const secondary = await capture(); assert.notEqual(secondary.gateway, 'absent'); assert.equal(secondary.auth, 'absent');
    await writeFile(codex, 'owned encrypted primary fixture', { mode: 0o600 });
    const both = await capture(); assert.notEqual(both.codex, 'absent'); assert.equal(both.gateway, secondary.gateway);
    await link(gateway, join(directory, 'gateway.alias')); await assert.rejects(capture, /credential authority/);
    await rm(join(directory, 'gateway.alias')); await rm(gateway); await symlink(codex, gateway);
    await assert.rejects(capture); await rm(gateway);
    await chmod(directory, 0o777); await assert.rejects(capture, /credential directory/); await chmod(directory, 0o755);
    await rm(directory, { recursive: true }); await mkdir(join(home, 'alias')); await symlink(join(home, 'alias'), directory);
    await assert.rejects(capture, /credential directory/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
Then('the actual runtime pins encrypted credential bytes separately from gateway sidecar locks', { timeout: 45000 }, async function () {
  const f = await nativeAccountSdkFixture({ anonymous: true, seedRuntime: seedNativeGateway });
  try {
    const before = await f.runtime.authority(), directory = join(f.home, 'secrets');
    await mkdir(directory, { recursive: true, mode: 0o755 }); await writeFile(join(directory, 'gateway_oauth.lock'), 'owned lock');
    assert.deepEqual(await f.runtime.authority(), before);
    await writeFile(join(directory, 'gateway_oauth.age'), 'owned ciphertext fixture', { mode: 0o600 });
    const gateway = await f.runtime.authority(); assert.notEqual(gateway.accountEpoch, before.accountEpoch);
    assert.deepEqual({ ...gateway, accountEpoch: before.accountEpoch }, before);
    assert.deepEqual(await f.runtime.authority(), gateway);
    await writeFile(join(directory, 'codex_auth.age'), 'owned primary ciphertext fixture', { mode: 0o600 });
    const primary = await f.runtime.authority(); assert.notEqual(primary.accountEpoch, gateway.accountEpoch);
    await rm(join(directory, 'gateway_oauth.age')); assert.notEqual((await f.runtime.authority()).accountEpoch, primary.accountEpoch);
    assert.equal(f.backend.requests.length, 0);
  } finally { await f.close(); }
});
Then('the actual SDK keeps gateway reads passive and releases an owned cancelled login', { timeout: 45000 }, async function () {
  const notes = [], f = await nativeAccountSdkFixture({ anonymous: true, explicitGateway: true, seedRuntime: seedNativeGateway, onNotification: frame => { if (frame.method === 'account/gatewayOAuth/changed') notes.push(frame.params); } });
  try {
    const initial = await f.call('account/gatewayOAuth/read'); assert.equal(initial.required, true); assert.equal(initial.status, 'notReady');
    assert.equal(f.backend.requests.length, 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = notes.length, pending = f.call('account/gatewayOAuth/login', null); void pending.catch(() => {});
      await waitForWatch(() => notes.slice(start).some(note => note.authUrl));
      const note = notes.slice(start).find(note => note.authUrl); assert.equal(note.providerId, 'owned_gateway'); assert.equal(new URL(note.authUrl).origin, f.backend.origin);
      assert.equal((await f.call('account/gatewayOAuth/read')).status, 'started');
      assert.deepEqual(await f.call('account/gatewayOAuth/cancel', null), {}); await assert.rejects(pending, /canceled/);
    }
    assert.equal((await f.call('account/gatewayOAuth/read')).status, 'failed'); assert.deepEqual(await f.call('account/gatewayOAuth/cancel', null), {});
    assert.equal(f.backend.requests.length, 0);
  } finally { await f.close(); }
});
