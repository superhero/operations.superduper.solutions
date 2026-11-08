// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeAccountAuthParams } from './lib/native-account-auth.ts';
import { nativeAccountSdkFixture } from '../tests/native-account-read-sdk.fixture.mjs';
import { nativeUuid } from './lib/native-runtime-contract.ts';
import { nativeAccountAuthFixture } from '../tests/native-account-auth.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { canStartVaultRequest } from './lib/secrets/request-policy.ts';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';

Before({ tags: '@native-account-auth' }, function () { this.accountAuthFixtures = []; });
After({ tags: '@native-account-auth' }, async function () { for (const c of this.accountAuthFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeAccountAuthFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.accountAuthFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, input = {}, signal, progress) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal, progress, next => c.reference = next);
  c.cancel = (input = {}, signal) => v.session.cancelNativeAccountLogin(c.reference, c.selections, c.select('account/login/cancel'), input, signal);
  return c;
}
async function key(world, options = {}) {
  const c = await setup(world, options), secret = 'OWNED_NATIVE_AUTH_' + randomUUID();
  c.f.backend?.allowedApiKeys.add(secret);
  const entries = await c.v.session.put(null, { label: 'Owned sign-in key', kind: 'secret', value: secret });
  c.credentialId = entries.find(e => e.label === 'Owned sign-in key').id; c.secret = secret; return c;
}
async function keyLoginAndLogout(c) {
  const initial = c.reference;
  const result = await c.execute('account/login/start', { type: 'apiKey', credentialId: c.credentialId });
  if (c.connection.requiresOpenaiAuth === false) { assert.equal(result.response.result.account, null); assert.equal(result.response.result.requiresOpenaiAuth, false); }
  else assert.equal(result.response.result.account.type, 'apiKey');
  assert.equal(c.reference.revision, initial.revision + 1);
  if (c.f.backend) assert.equal(JSON.parse(await readFile(join(c.f.home, 'auth.json'), 'utf8')).OPENAI_API_KEY, c.secret);
  assert.equal(JSON.stringify(result).includes(c.secret), false); assert.equal(result.request.params.credentialId, c.credentialId);
  const login = c.reference;
  assert.deepEqual((await c.execute('account/logout')).response.result, {}); assert.equal(c.reference.revision, login.revision + 1);
  const connections = await c.v.session.nativeConnections(); assert.equal(connections.find(row => row.id === c.reference.id).accountType, 'none');
  assert.ok(!c.f.frames.some(frame => ['thread/start', 'turn/start'].includes(frame.method)));
}
Then('workflow key sign-in and logout update only their confirmed encrypted pairing', async function () { await keyLoginAndLogout(await key(this)); });
Then('workflow public browser and device sign-in keep instructions transient until confirmation', async function () {
  for (const type of ['chatgpt', 'chatgptDeviceCode']) {
    const c = await setup(this); let notice, settled = false;
    const pending = c.execute('account/login/start', { type }, undefined, value => { notice = value; });
    void pending.then(() => { settled = true; }, () => {}); await waitForWatch(() => notice?.kind === 'login'); assert.equal(settled, false);
    assert.equal(notice.login, type); assert.ok(nativeUuid(notice.loginId)); c.f.finishLogin();
    const result = await pending; assert.equal(result.response.result.account.type, 'chatgpt');
    assert.equal(JSON.stringify(result).includes(notice.loginId), false); assert.equal(JSON.stringify(result).includes('verificationUrl'), false); assert.equal(JSON.stringify(result).includes('authUrl'), false);
  }
});
Then('workflow cancellation rejects foreign IDs and completes only its owned pending attempt', async function () {
  assert.equal(canStartVaultRequest(['executeNativeRuntime'], 'cancelNativeAccountLogin'), true);
  assert.equal(canStartVaultRequest(['executeNativeRuntime'], 'put'), false);
  assert.equal(canStartVaultRequest(['executeNativeRuntime', 'cancelNativeAccountLogin'], 'cancelNativeAccountLogin'), false);
  const c = await setup(this), initial = c.reference; let notice;
  const pending = c.execute('account/login/start', { type: 'chatgpt' }, undefined, value => { notice = value; }); void pending.catch(() => {});
  await waitForWatch(() => notice?.kind === 'login'); await assert.rejects(c.cancel({ loginId: randomUUID() }), error => error.code === 'PERMISSION');
  assert.deepEqual((await c.cancel({ loginId: notice.loginId.toUpperCase() })).response.result, { status: 'canceled' });
  await assert.rejects(pending, error => error.code === 'CANCELLED'); assert.deepEqual(c.reference, initial);
  assert.equal(c.f.frames.filter(frame => frame.method === 'account/login/cancel').length, 1);
});
Then('authentication workflows require their independent grant and reject agent escalation', async function () {
  const denied = await key(this, { allowAccountAuth: false, allowAgent: true });
  await assert.rejects(denied.execute('account/login/start', { type: 'apiKey', credentialId: denied.credentialId }));
  assert.equal(denied.f.frames.filter(frame => frame.method === 'account/login/start').length, 0);
  const c = await setup(this); await c.v.session.disconnectNativeRuntime(c.reference); await waitForWatch(() => c.f.starts === c.f.stops);
  const ticket = await c.f.ticket({ connectionId: randomUUID(), method: 'codex-account-auth', fingerprint: 'd'.repeat(64) }); assert.equal(ticket.status, 200);
  const socket = await c.f.socket(ticket.value.ticket); await socket.next(); socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'agent', method: 'thread/start', params: {} })); await waitForWatch(() => socket.ws.readyState === 3);
  assert.ok(!c.f.frames.some(frame => frame.method === 'thread/start')); socket.ws.terminate();
});
Then('the actual SDK authenticates logs out and cancels through the encrypted workflow broker', { timeout: 45000 }, async function () {
  const c = await key(this, { real: true }); await keyLoginAndLogout(c); let notice;
  const pending = c.execute('account/login/start', { type: 'chatgpt', appBrand: 'codex', useHostedLoginSuccessPage: false }, undefined, value => { notice = value; }); void pending.catch(() => {});
  await waitForWatch(() => notice?.kind === 'login'); assert.ok(nativeUuid(notice.loginId));
  assert.deepEqual((await c.cancel({ loginId: notice.loginId.toUpperCase() })).response.result, { status: 'canceled' });
  await assert.rejects(pending, error => error.code === 'CANCELLED');
  assert.ok(c.f.frames.some(frame => frame.method === 'account/logout' && frame.params === null));
  assert.ok(c.f.backend.requests.every(request => request.authorized || request.method === 'GET' && ['/v1/models', '/plugins/featured'].includes(request.path)), JSON.stringify(c.f.backend.requests.map(({ method, path, authorized }) => ({ method, path, authorized }))));
});
Then('account authentication preserves native provider metadata when authentication is optional', { timeout: 45000 }, async function () {
  await keyLoginAndLogout(await key(this, { real: true, requiresOpenaiAuth: false }));
});
Then('authentication models preserve their wire declarations and portable confirmation ports', async function () {
  const source = await readServiceSchema('codex');
  for (const method of ['account/login/start', 'account/login/cancel', 'account/logout']) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.deepEqual(scopeNativeRpcSchema(document, method), document); assert.equal(operation.unavailableReason, undefined);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document);
    const saved = { version: 3, id: 'account-auth', name: 'Account authentication', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(saved))), saved);
    assert.ok(document['x-operations-native-workflow'].wireResult);
    if (method === 'account/login/start') {
      assert.equal(operation.fields.find(field => field.name === 'type').defaultValue, 'chatgptDeviceCode');
      const credentialId = randomUUID(); assert.deepEqual(prepareNativeRequest(operation, { 'params:type': 'apiKey', 'params:credentialId': credentialId }).params, { type: 'apiKey', credentialId });
      assert.equal(document['x-operations-native-workflow'].wireConfirmation.$ref, '#/definitions/v2/GetAccountResponse');
      assert.ok(graph.nodes.filter(node => node.type === 'data').flatMap(node => node.data.fields).some(field => JSON.parse(decodeURIComponent(field.id))[1] === '/result/requiresOpenaiAuth'));
    }
  }
});
Then('workflow sign-in rejects source identity lock and cancellation changes without adopting a profile', async function () {
  for (const mode of ['source', 'identity', 'lock', 'cancel']) {
    const c = await setup(this), initial = c.reference, controller = new AbortController(); let notice;
    const pending = c.execute('account/login/start', { type: 'chatgptDeviceCode' }, controller.signal, value => { notice = value; }); void pending.catch(() => {});
    await waitForWatch(() => notice?.kind === 'login');
    if (mode === 'source') c.v.enabled = false; else if (mode === 'identity') c.f.identity.generation = randomUUID(); else if (mode === 'lock') c.v.session.lock(); else controller.abort();
    if (mode === 'source' || mode === 'identity') c.f.finishLogin();
    await assert.rejects(pending); assert.deepEqual(c.reference, initial);
  }
});
Then('authentication confirmation withholds raw and encoded native credential echoes', async function () {
  for (const encoding of ['plain', 'base64url', 'utf16-base64', 'utf16-le', 'utf16-be']) {
    const c = await setup(this), initial = c.reference, token = 'OWNED_PRIVATE_NATIVE_TOKEN_' + randomUUID(); let notice;
    const pending = c.execute('account/login/start', { type: 'chatgpt' }, undefined, value => { notice = value; }); void pending.catch(() => {});
    await waitForWatch(() => notice?.kind === 'login');
    await writeFile(join(c.f.home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: token } }), { mode: 0o600 });
    const echo = encoding === 'plain' ? token : encoding === 'base64url' ? Buffer.from(token).toString('base64url')
      : encoding === 'utf16-base64' ? Buffer.from(token, 'utf16le').toString('base64')
        : encoding === 'utf16-le' ? Buffer.from(token, 'utf16le').toString('utf8') : Buffer.from(token, 'utf16le').swap16().toString('utf8');
    c.f.finishLogin(); c.f.account.email = echo;
    await assert.rejects(pending); assert.deepEqual(c.reference, initial);
  }
});

Then('account authentication inputs preserve public modes and private key references', function () {
  assert.deepEqual(nativeAccountAuthParams('account/login/start', {}), { type: 'chatgptDeviceCode' });
  const credentialId = randomUUID(); assert.deepEqual(nativeAccountAuthParams('account/login/start', { type: 'apiKey', credentialId }), { type: 'apiKey', credentialId });
  const options = { type: 'chatgpt', appBrand: 'chatgpt', codexStreamlinedLogin: false, useHostedLoginSuccessPage: true };
  assert.deepEqual(nativeAccountAuthParams('account/login/start', options), options);
  assert.equal(nativeAccountAuthParams('account/login/start', { type: 'chatgpt', appBrand: null }).appBrand, null);
  assert.deepEqual(nativeAccountAuthParams('account/login/cancel', {}), {});
  assert.deepEqual(nativeAccountAuthParams('account/login/cancel', { loginId: credentialId }), { loginId: credentialId });
  assert.deepEqual(nativeAccountAuthParams('account/logout', null), {});
});
Then('account authentication inputs name invalid modes keys and browser options', function () {
  for (const [input, field] of [
    [{ type: 'chatgptAuthTokens' }, 'type'], [{ type: 'chatgpt', accessToken: 'unavailable' }, 'accessToken'], [{ type: 'apiKey', apiKey: 'plain-key' }, 'apiKey'],
    [{ type: 'apiKey' }, 'credentialId'], [{ type: 'apiKey', credentialId: randomUUID(), appBrand: null }, 'appBrand'],
    [{ type: 'chatgptDeviceCode', codexStreamlinedLogin: true }, 'codexStreamlinedLogin'],
    [{ type: 'chatgpt', credentialId: randomUUID() }, 'credentialId'], [{ type: 'chatgpt', appBrand: 'foreign' }, 'appBrand']
  ]) assert.throws(() => nativeAccountAuthParams('account/login/start', input), error => error.field === field);
  assert.throws(() => nativeAccountAuthParams('account/login/cancel', { loginId: 'foreign' }), error => error.field === 'loginId');
  assert.throws(() => nativeAccountAuthParams('account/logout', { revokeOtherAccount: true }), error => error.field === 'revokeOtherAccount');
});
Then('the pinned SDK signs in with an owned key logs out and cancels its own browser attempt', { timeout: 45000 }, async function () {
  const f = await nativeAccountSdkFixture({ anonymous: true });
  try {
    assert.equal((await f.call('account/read', { refreshToken: false })).account, null);
    assert.deepEqual(await f.call('account/login/start', { type: 'apiKey', apiKey: f.backend.access }), { type: 'apiKey' });
    assert.equal((await f.call('account/read', { refreshToken: false })).account.type, 'apiKey');
    assert.equal(JSON.parse(await readFile(join(f.home, 'auth.json'), 'utf8')).OPENAI_API_KEY, f.backend.access);
    assert.deepEqual(await f.call('account/logout', null), {});
    assert.equal((await f.call('account/read', { refreshToken: false })).account, null);
    const login = await f.call('account/login/start', { type: 'chatgpt', appBrand: 'codex', codexStreamlinedLogin: false, useHostedLoginSuccessPage: false });
    assert.equal(login.type, 'chatgpt'); assert.ok(nativeUuid(login.loginId)); assert.equal(new URL(login.authUrl).hostname, 'auth.openai.com');
    assert.deepEqual(await f.call('account/login/cancel', { loginId: login.loginId }), { status: 'canceled' });
    assert.deepEqual(await f.call('account/login/cancel', { loginId: login.loginId }), { status: 'notFound' });
    assert.equal((await f.call('account/read', { refreshToken: false })).account, null);
    assert.ok(f.backend.requests.every(request => request.authorized || request.method === 'GET' && ['/v1/models', '/plugins/featured'].includes(request.path)));
  } finally { await f.close(); }
});
