// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { VaultSession } from './lib/secrets/session.ts';
import { VaultError } from './lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { GitlabOAuthBroker } from './lib/secrets/gitlab-oauth.ts';
import { gitlabCallbackUri, gitlabOAuthAlternative } from './lib/secrets/gitlab-config.ts';
import { waitGitlabCallback, oauthCallbackMessage } from './lib/secrets/oauth-popup.ts';
import { httpConnectionReference, formatHttpToken } from './lib/secrets/http-connections.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { takeGitlabCallback } from './index.ts';
import { portableWorkflowDocument } from './lib/workflow-document.ts';

const origin = 'https://operations.example.test', clientId = 'a'.repeat(64), redirectUri = origin+'/?operations_oauth_callback=gitlab';
const code = 'GL_AUTH_CODE_PRIVATE_5729';
const input = { clientId, redirectUri, label: 'GitLab work' };
const operation = { id: 'gitlab-fixture:user', name: 'Current user', description: '', group: 'GitLab', method: 'GET', path: '/api/v4/user',
  fields: [], bodyRequired: false, responseMediaType: 'application/json',
  security: [[{ name: 'http', kind: 'bearer', header: 'Authorization' }], [{ name: 'oauth2', kind: 'bearer', header: 'Authorization' }], [{ name: 'apiKey', kind: 'apiKey', header: 'PRIVATE-TOKEN' }]] };
const refused = error => error instanceof VaultError;
async function fixture() {
  const key = await newVaultKey(), id = crypto.randomUUID(), methodId = crypto.randomUUID(), recovery = randomBase64(128), salt = randomBase64(16);
  const envelope = { id: methodId, kind: 'recovery', revision: 1, salt,
    wrappedKey: await wrapVaultKey(key, await recoveryKey(recovery, salt), { vaultId: id, epoch: 1, kind: 'recovery', id: methodId, revision: 1 }) };
  const storage = { state: { revision: 1, lockEpoch: 1, snapshot: await sealSnapshot({ id, epoch: 1, revision: 1, envelopes: [envelope], records: [] }, key) },
    async read() { return structuredClone(this.state); },
    async replace(expected, snapshot, keys) {
      if (expected.revision !== this.state.revision || expected.lockEpoch !== this.state.lockEpoch) throw new VaultError('CONFLICT');
      this.state = { revision: this.state.revision+1, lockEpoch: this.state.lockEpoch+1, snapshot: structuredClone(snapshot), keys: structuredClone(keys) }; return this.read();
    }, async indexKeys(expected, keys) { assert.equal(expected.revision, this.state.revision); this.state.keys = structuredClone(keys); return this.read(); },
    async lock() { this.state.revision++; this.state.lockEpoch++; return this.read(); } };
  const descriptor = await approvedOperation(operation, 'https://gitlab.com'), proof = { methodId, secret: recovery };
  const f = { storage, proof, descriptor, key, events: [], privateValues: [code], tokens: new Map(), refreshTokens: new Map(), now: Date.now(),
    account: '42', username: 'gitlab_user', applicationOrigin: origin, enabled: true, scope: 'read_user', authCalls: 0, refreshCalls: 0, identityReads: 0, resourceReads: 0,
    ttl: 3600, failGrant: false, failResource: false, echo: false, refreshAccount: undefined, onRefresh: undefined };
  const verified = new Set();
  f.provider = async (url, init = {}) => {
    const target = new URL(url); assert.equal(target.origin, 'https://gitlab.com');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
    f.events.push({ url: target.href, init });
    if (target.pathname === '/oauth/token') {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('client_id'), clientId); assert.equal(body.get('redirect_uri'), redirectUri); assert.equal(body.has('client_secret'), false);
      const refresh = body.get('grant_type') === 'refresh_token';
      if (refresh) {
        f.refreshCalls++; await f.onRefresh?.();
        assert.equal(f.refreshTokens.has(body.get('refresh_token')), true);
      } else {
        f.authCalls++; assert.equal(body.get('code'), code); assert.match(body.get('code_verifier'), /^[a-zA-Z0-9_-]{43}$/);
        f.privateValues.push(body.get('code_verifier'));
      }
      if (f.failGrant) return Response.json({ error: 'invalid_grant', error_description: f.privateValues.join(' ') }, { status: 400 });
      const serial = f.authCalls + f.refreshCalls;
      const accessToken = 'GL_ACCESS_PRIVATE_5729_'+serial, refreshToken = 'GL_REFRESH_PRIVATE_5729_'+serial;
      const account = refresh ? f.refreshAccount ?? f.refreshTokens.get(body.get('refresh_token')) : f.account;
      if (refresh) f.refreshTokens.delete(body.get('refresh_token'));
      f.tokens.set(accessToken, account); f.refreshTokens.set(refreshToken, account); f.privateValues.push(accessToken, refreshToken);
      return Response.json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer', expires_in: f.ttl, scope: f.scope });
    }
    assert.equal(target.pathname, '/api/v4/user');
    const authorization = new Headers(init.headers).get('Authorization'); assert.ok(authorization?.startsWith('Bearer '));
    const token = authorization.slice(7); assert.ok(f.tokens.has(token), 'The resource did not receive a managed access token');
    if (!verified.has(token)) { verified.add(token); f.identityReads++; }
    else f.resourceReads++;
    // Resource echoes exercise its managed token material; discarded code/verifier values are not resource inputs.
    const echoes = [...f.tokens.keys(), ...f.refreshTokens.keys()].flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]);
    if (f.failResource) return Response.json({ echo: echoes }, { status: 401 });
    return Response.json({ id: Number(f.tokens.get(token)), username: f.username, ...(f.echo ? { echo: echoes } : {}) });
  };
  const runtime = { now: () => f.now, applicationOrigin: () => f.applicationOrigin, fetchRequest: f.provider };
  f.newSession = () => new VaultSession(storage, undefined, async () => { if (!f.enabled) throw new VaultError('PERMISSION'); }, runtime);
  f.session = f.newSession(); await f.session.unlock(proof);
  f.begin = (value = input, replace) => f.session.beginGitlabOAuth(value, descriptor, replace);
  f.complete = task => f.session.completeGitlabOAuth(task.id, { state: task.state, code });
  f.connect = async () => { const task = await f.begin(), connection = await f.complete(task); f.connection = connection; return connection; };
  f.binding = connection => f.session.connectionBinding(httpConnectionReference(connection ?? f.connection), descriptor);
  f.execute = async (binding, session = f.session, descriptor_ = descriptor) => {
    const previous = globalThis.fetch; globalThis.fetch = f.provider;
    try { return await session.execute(descriptor_, {}, binding ?? await session.connectionBinding(httpConnectionReference(f.connection), descriptor_)); }
    finally { globalThis.fetch = previous; }
  };
  return f;
}
function safe(f, value) {
  const serialized = JSON.stringify(value);
  for (const secret of f.privateValues) for (const item of [secret, encodeURIComponent(secret), new URLSearchParams({ v: secret }).toString().slice(2)])
    assert.ok(!serialized.includes(item), 'Managed OAuth material crossed a public boundary');
}

Then('GitLab public authorization uses independent state and the published S256 challenge without a client secret', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const bytes = Uint8Array.from(Buffer.from(verifier, 'base64url')); let calls = 0;
  const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => { array.set(++calls === 1 ? new Uint8Array(32).fill(1) : bytes); return array; });
  try {
    const broker = new GitlabOAuthBroker({ applicationOrigin: () => origin }), descriptor = await approvedOperation(operation, 'https://gitlab.com');
    const task = await broker.begin(input, descriptor), url = new URL(task.authorizationUrl);
    assert.equal(url.origin, 'https://gitlab.com'); assert.equal(url.pathname, '/oauth/authorize');
    assert.equal(url.searchParams.get('code_challenge'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('scope'), 'read_user');
    assert.equal(url.searchParams.has('client_secret'), false); assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
    assert.ok(!task.authorizationUrl.includes(verifier)); assert.notEqual(task.state, verifier);
    const taken = broker.take(task.id, { state: task.state, code }); assert.equal(taken.pending.verifier, verifier);
    assert.throws(() => broker.take(task.id, { state: task.state, code }), refused);
  } finally { spy.mockRestore(); }
});

Then('the GitLab current user profile uses its native OAuth2 alternative and fixed authority', async () => {
  const raw = await readServiceSchemaUpstream('gitlab'), doc = await readServiceSchema('gitlab'); assert.deepEqual(doc, raw);
  assert.equal(createHash('sha256').update(JSON.stringify(raw)).digest('hex'), 'e5ab69dc7cbfde3b2f2a6c27faccf33a57dabaa70967bb0b52697633050e13e3');
  assert.equal(serviceSchemaDescriptors.find(item => item.id === 'gitlab').version, '19.5');
  const models = inspectServiceSchema(doc, 'gitlab', new Set(['gitlab:getApiV4User'])).operations;
  assert.equal(models.length, 1); assert.equal(models[0].unavailableReason, undefined);
  const d = await approvedOperation(models[0], 'https://gitlab.com'); assert.equal(gitlabOAuthAlternative(d), 1);
  assert.deepEqual(d.operation.security.map(option => option[0].name), ['http', 'oauth2', 'apiKey']);
  for (const changed of [{ ...d, origin: 'https://other.example.test' }, { ...d, operation: { ...d.operation, method: 'POST' } },
    { ...d, operation: { ...d.operation, path: '/api/v4/projects' } }]) assert.equal(gitlabOAuthAlternative(changed), undefined);
  assert.throws(() => formatHttpToken('gitlab-oauth', 'value'), refused);
});

Then('GitLab consent returns only a saved reference and ordinary vault reads cannot expose managed tokens', async () => {
  const f = await fixture(), task = await f.begin(); assert.equal(f.events.length, 0);
  const connection = await f.complete(task); f.connection = connection;
  assert.equal(connection.format, 'gitlab-oauth'); assert.equal(connection.alternative, 1); assert.equal(connection.oauth.accountId, '42');
  assert.equal(f.authCalls, 1); assert.equal(f.identityReads, 1); safe(f, connection);
  const entries = await f.session.list(); assert.equal(entries.length, 1); assert.equal(entries[0].oauthState, undefined); safe(f, entries);
  const copied = await f.session.copyCredential(entries[0].id); assert.match(copied, /^[a-f0-9-]{36}$/); safe(f, copied);
  const binding = await f.binding(); assert.deepEqual(binding.credentials, {}); safe(f, binding); safe(f, f.storage.state); safe(f, await f.session.backup(f.proof));
  await assert.rejects(f.session.put(null, { id: entries[0].id, label: 'Modified', kind: 'secret', value: 'replacement-value' }), refused);
  const document = { version: 3, id: 'oauth', name: 'OAuth', nodes: [{ id: 'user', type: 'operation', position: { x: 0, y: 0 },
    data: { operationId: operation.id, name: operation.name, method: 'GET', path: operation.path, description: '', credentialBinding: binding } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.ok(!JSON.stringify(portableWorkflowDocument(document)).includes(connection.id));
});

Then('GitLab preserves full connection names and account identities while bounding display labels', async () => {
  const f = await fixture(), label = 'L'.repeat(100); f.username = 'u'.repeat(128);
  const task = await f.begin({ ...input, label }), connection = await f.complete(task);
  assert.equal(connection.label, label); assert.equal(connection.account.length, 120); assert.equal(connection.oauth.accountId, '42');
  const records = await f.session.list(); assert.equal(records[0].label, label+' reference'); safe(f, records);
});

Then('an encrypted GitLab connection survives reload and private resource execution retains its account', async () => {
  const f = await fixture(); await f.connect(); const reference = httpConnectionReference(f.connection);
  f.session.lock(); const reloaded = f.newSession(); await reloaded.unlock(f.proof);
  const binding = await reloaded.connectionBinding(reference, f.descriptor), result = await f.execute(binding, reloaded);
  assert.equal(result.response.body.id, 42); assert.equal(f.authCalls, 1); assert.equal(f.refreshCalls, 0); assert.equal(f.resourceReads, 1); safe(f, result);
});

Then('concurrent GitLab use and a stale snapshot share one atomic rotating refresh', async () => {
  const f = await fixture(); f.ttl = 60; await f.connect(); const binding = await f.binding(); f.now += 60001; f.ttl = 3600;
  const previous = globalThis.fetch; globalThis.fetch = f.provider;
  try {
    const results = await Promise.all([f.session.execute(f.descriptor, {}, binding), f.session.execute(f.descriptor, {}, binding)]);
    assert.equal(f.refreshCalls, 1); assert.equal(f.resourceReads, 2); results.forEach(result => safe(f, result));
    assert.deepEqual(httpConnectionReference((await f.session.connections())[0]), httpConnectionReference(f.connection));
  } finally { globalThis.fetch = previous; }
  // A caller holding a pre-renewal snapshot after the flight settles still cannot reuse its rotating grant.
  const broker = new GitlabOAuthBroker({ now: () => f.now, applicationOrigin: () => origin, fetchRequest: f.provider });
  const oldRefresh = [...f.refreshTokens.keys()][0], oldAccess = [...f.tokens.keys()].at(-1);
  const state = { profile: 'gitlab-public-pkce-v1', oauth: f.connection.oauth, username: 'gitlab_user', accessToken: oldAccess, refreshToken: oldRefresh, expiresAt: f.now-1 };
  let saved = 0;
  const first = await broker.ensure('same-record', state, undefined, async () => {}, async () => { saved++; });
  const second = await broker.ensure('same-record', state, undefined, async () => {}, async () => { assert.fail('A stale snapshot persisted twice'); });
  assert.deepEqual(second, first); assert.equal(saved, 2); assert.equal(f.refreshCalls, 2);
});

Then('GitLab stores an encrypted refresh lease before exchange and requires reconnect after interruption', async () => {
  const f = await fixture(); f.ttl = 60; await f.connect(); const binding = await f.binding(); f.now += 60001;
  f.onRefresh = async () => { assert.ok(!JSON.stringify(f.storage.state).includes('refreshPending')); f.session.lock(); throw new Error('interrupted'); };
  await assert.rejects(f.execute(binding), refused); assert.equal(f.resourceReads, 0);
  const reloaded = f.newSession(); await reloaded.unlock(f.proof);
  await assert.rejects(reloaded.connectionBinding(httpConnectionReference(f.connection), f.descriptor), refused);
  const count = f.refreshCalls; await assert.rejects(f.execute(binding, reloaded), refused); assert.equal(f.refreshCalls, count); safe(f, f.storage.state);
});

Then('invalid GitLab callbacks and changed schema authority cannot exchange or save credentials', async () => {
  for (const mode of ['state', 'denied', 'expired', 'cancelled', 'locked', 'schema', 'origin', 'late']) {
    const f = await fixture(), task = await f.begin(); let callback = { state: task.state, code };
    if (mode === 'state') callback.state = 'different';
    if (mode === 'denied') callback = { state: task.state, error: 'access_denied' };
    if (mode === 'expired') f.now += 300001;
    if (mode === 'cancelled') await f.session.cancelGitlabOAuth(task.id);
    if (mode === 'locked') f.session.lock();
    if (mode === 'schema') f.enabled = false;
    if (mode === 'origin') f.applicationOrigin = 'https://changed.example.test';
    if (mode === 'late') { await f.complete(task); await assert.rejects(f.complete(task), refused); assert.equal(f.authCalls, 1); continue; }
    await assert.rejects(f.session.completeGitlabOAuth(task.id, callback), refused); assert.equal(f.authCalls, 0);
    if (mode !== 'locked') assert.equal((await f.session.list()).length, 0);
  }
});

Then('GitLab tokens reject changed scopes accounts registration origins and resource destinations', async () => {
  const scope = await fixture(); scope.scope = 'api'; const task = await scope.begin(); await assert.rejects(scope.complete(task), refused); assert.equal((await scope.session.list()).length, 0);
  const f = await fixture(); f.ttl = 60; await f.connect(); const binding = await f.binding(); f.now += 60001; f.refreshAccount = '99';
  await assert.rejects(f.execute(binding), refused); assert.equal(f.resourceReads, 0);
  const other = await fixture(); await other.connect(); const selected = await other.binding();
  const destination = await approvedOperation(operation, 'https://evil.example.test');
  await assert.rejects(other.execute({ ...selected, fingerprint: destination.fingerprint }, other.session, destination), refused); assert.equal(other.resourceReads, 0);
  other.applicationOrigin = 'https://other-application.example.test'; await assert.rejects(other.binding(), refused);
  for (const redirect of ['https://evil.example.test/?operations_oauth_callback=gitlab', origin+'/?operations_oauth_callback=gitlab&extra=x', 'http://remote.example.test/?operations_oauth_callback=gitlab'])
    await assert.rejects(other.begin({ ...input, redirectUri: redirect }), refused);
});

Then('GitLab reconnect preserves the selected account and disconnect removes its managed state', async () => {
  const f = await fixture(); await f.connect(); const old = httpConnectionReference(f.connection);
  const task = await f.begin(input, old), next = await f.complete(task);
  assert.equal(next.id, old.id); assert.equal(next.revision, old.revision+1); await assert.rejects(f.session.connectionBinding(old, f.descriptor), refused);
  f.connection = next; f.account = '99';
  const wrong = await f.begin(input, httpConnectionReference(next)); await assert.rejects(f.complete(wrong), refused);
  assert.deepEqual((await f.session.connections()).map(httpConnectionReference), [httpConnectionReference(next)]);
  await f.session.removeConnection(httpConnectionReference(next)); assert.deepEqual(await f.session.list(), []);
  await assert.rejects(f.binding(), refused);
});

Then('GitLab access refresh and derived values are scrubbed and grant failures do not replay resource requests', async () => {
  const f = await fixture(); await f.connect(); f.echo = true;
  const result = await f.execute(); assert.equal(result.response.redacted, true); safe(f, result);
  f.failResource = true;
  const error = await f.execute().catch(error => error); safe(f, { message: error.message, response: error.response }); assert.equal(error.cause, undefined); assert.equal(f.refreshCalls, 0);
  const failed = await fixture(); failed.ttl = 60; await failed.connect(); const binding = await failed.binding(); failed.now += 60001; failed.failGrant = true;
  const rejected = await failed.execute(binding).catch(error => error); assert.equal(rejected.code, 'AUTHORIZATION'); safe(failed, { message: rejected.message });
  assert.equal(failed.refreshCalls, 1); assert.equal(failed.resourceReads, 0);
  await assert.rejects(failed.execute(binding), refused); assert.equal(failed.refreshCalls, 1);
});

Then('the reserved GitLab callback strips code and state and rejects duplicate or invalid responses', () => {
  assert.equal(gitlabCallbackUri(origin+'/index.html?workspace=test#fragment'), origin+'/index.html?operations_oauth_callback=gitlab');
  let cleaned = '';
  const host = search => ({ location: { pathname: '/index.html', search }, history: { replaceState(_state, _title, url) { cleaned = url; } } });
  const state = 's'.repeat(43);
  assert.deepEqual(takeGitlabCallback(host('?operations_oauth_callback=gitlab&code='+code+'&state='+state)), { code, state });
  assert.equal(cleaned, '/index.html?operations_oauth_callback=gitlab'); assert.ok(!cleaned.includes(code));
  for (const query of ['&code=first&code=second&state='+state, '&state='+state+'&state=duplicate&code='+code, '&code='+code+'&state=wrong', '&error=access_denied&code='+code+'&state='+state])
    assert.equal(takeGitlabCallback(host('?operations_oauth_callback=gitlab'+query)).error, 'invalid_callback');
  assert.equal(takeGitlabCallback(host('?ordinary=page&code=unrelated')), undefined);
});

Then('GitLab ignores foreign callback messages and a severed opener can return through its channel or cancel', async () => {
  const channels = [], host = Object.assign(new EventTarget(), { location: { origin } });
  class CallbackChannel extends EventTarget {
    constructor() { super(); channels.push(this); }
    close() { this.closed = true; }
  }
  const popup = { closed: true, close() {} }, task = { id: crypto.randomUUID(), state: 's'.repeat(43), expiresAt: Date.now()+300000 };
  const controller = new AbortController(), cancelled = new AbortController();
  vi.useFakeTimers(); vi.stubGlobal('window', host); vi.stubGlobal('BroadcastChannel', CallbackChannel);
  try {
    let settled = false;
    const result = waitGitlabCallback(popup, task, controller.signal);
    void result.then(() => { settled = true; }, () => { settled = true; });
    const data = { source: oauthCallbackMessage, state: task.state, code };
    const message = (sender, from) => host.dispatchEvent(Object.assign(new Event('message'), { source: sender, origin: from, data }));
    message({}, origin); message(popup, 'https://foreign.example.test');
    channels[0].dispatchEvent(new MessageEvent('message', { data: { ...data, state: 'wrong' } }));
    await vi.advanceTimersByTimeAsync(300); assert.equal(settled, false);
    channels[0].dispatchEvent(new MessageEvent('message', { data }));
    assert.deepEqual(await result, { state: task.state, code }); assert.equal(channels[0].closed, true);
    const interrupted = waitGitlabCallback(popup, task, cancelled.signal); cancelled.abort();
    await assert.rejects(interrupted, error => error instanceof VaultError && error.code === 'CANCELLED');
    assert.equal(channels[1].closed, true);
  } finally { controller.abort(); cancelled.abort(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
