// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { atprotoProvider, fixtureScope } from '../tests/atproto-oauth.fixture.mjs';
import { VaultSession } from './lib/secrets/session.ts';
import { VaultError } from './lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { AtprotoOAuthBroker, validateAtprotoTransport, validateAtprotoRefresh, validateAtprotoContinuation } from './lib/secrets/atproto-oauth.ts';
import { atprotoOAuthAlternative, atprotoCallbackUri, atprotoClientId, publicAtprotoUrl, validateAtprotoInput, validateAtprotoMetadata, atprotoProxy } from './lib/secrets/atproto-config.ts';
import { validateAtprotoState, managedAtprotoSecrets } from './lib/secrets/atproto-state.ts';
import { createAtprotoHttpConnection, httpConnectionLimit, formatHttpToken, httpConnectionReference, validateHttpConnection } from './lib/secrets/http-connections.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { takeAtprotoCallback } from './index.ts';
const refused = error => error instanceof VaultError;
const origin = 'https://operations.example.com', redirectUri = origin + '/?operations_oauth_callback=bluesky';
const input = { identifier: 'alice.example.com', clientId: origin + '/oauth/bluesky-client-metadata.json', redirectUri, label: 'Bluesky work' };
async function fixture() {
  const f = atprotoProvider(origin), key = await newVaultKey(), id = crypto.randomUUID(), methodId = crypto.randomUUID(), recovery = randomBase64(128), salt = randomBase64(16);
  const envelope = { id: methodId, kind: 'recovery', revision: 1, salt,
    wrappedKey: await wrapVaultKey(key, await recoveryKey(recovery, salt), { vaultId: id, epoch: 1, kind: 'recovery', id: methodId, revision: 1 }) };
  const storage = { state: { revision: 1, lockEpoch: 1, snapshot: await sealSnapshot({ id, epoch: 1, revision: 1, envelopes: [envelope], records: [] }, key) },
    async read() { return structuredClone(this.state); }, async replace(expected, snapshot, keys) {
      if (expected.revision !== this.state.revision || expected.lockEpoch !== this.state.lockEpoch) throw new VaultError('CONFLICT');
      this.state = { revision: this.state.revision + 1, lockEpoch: this.state.lockEpoch + 1, snapshot: structuredClone(snapshot), keys: structuredClone(keys) }; return this.read();
    }, async indexKeys(expected, keys) { assert.equal(expected.revision, this.state.revision); this.state.keys = structuredClone(keys); return this.read(); },
    async lock() { this.state.revision++; this.state.lockEpoch++; return this.read(); } };
  const doc = await readServiceSchema('bluesky-app'), operation = inspectServiceSchema(doc, 'bluesky-app', new Set(['bluesky-app:app.bsky.actor.getPreferences'])).operations[0];
  assert.ok(operation); const descriptor = await approvedOperation(operation, f.pds), proof = { methodId, secret: recovery };
  Object.assign(f, { key, storage, descriptor, proof, enabled: true });
  f.newSession = () => new VaultSession(storage, () => {}, async approved => { if (!f.enabled || approved.fingerprint !== descriptor.fingerprint) throw new VaultError('PERMISSION'); }, {}, {}, {}, {}, { applicationOrigin: origin, fetchRequest: f.fetch });
  f.session = f.newSession(); await f.session.unlock(proof);
  f.connect = async replace => { const task = await f.session.beginAtprotoOAuth(input, descriptor, replace); return f.session.completeAtprotoOAuth(task.id, f.consent(task.authorizationUrl)); };
  f.binding = connection => f.session.connectionBinding(httpConnectionReference(connection), descriptor);
  return f;
}
Then('Bluesky OAuth keeps every native identity and qualifies only the reviewed preferences read', async () => {
  const pins = {'bluesky-app': 'fe25786ae7c7b547a1516528e9bf5526d39ced533d5ccefe98b61f0c9d91914e', 'bluesky-dms': 'a9b753deaf695d7f81583305631eb99169f31867d92a877225d18371d4fb176f', 'bluesky-moderation': 'ed02002080f25c220e3d8280ee63d65ac70ad3c56e9af4033646dcf9cc0e9913'};
  const counts = [];
  for (const name of ['bluesky-app', 'bluesky-dms', 'bluesky-moderation']) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`./catalogs/services/${name}.json.gz`, import.meta.url))).digest('hex'), pins[name]);
    const doc = await readServiceSchema(name), ids = Object.values(doc.paths).flatMap(path => Object.values(path).filter(value => value && typeof value === 'object' && value.operationId).map(value => value.operationId));
    counts.push(ids.length); assert.equal(new Set(ids).size, ids.length);
  }
  assert.deepEqual(counts, [152, 38, 45]); const f = await fixture(); assert.equal(atprotoOAuthAlternative(f.descriptor), 0);
  const other = await approvedOperation({ ...f.descriptor.operation, path: '/xrpc/app.bsky.actor.putPreferences', method: 'POST' }, f.pds);
  assert.equal(atprotoOAuthAlternative(other), undefined);
  assert.equal(f.descriptor.operation.security[0][0].kind, 'bearer');
});
Then('Bluesky OAuth verifies PAR PKCE ES256 proofs and separate server nonces', async () => {
  const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection);
  const result = await f.session.execute(f.descriptor, {}, binding); assert.deepEqual(result.response.body, { preferences: [] });
  assert.equal(connection.oauth.accountId, f.did); assert.equal(connection.oauth.scope, fixtureScope); assert.equal(f.tokenCalls, 1); assert.equal(f.resources, 1);
  assert.ok(f.nonceChallenges >= 2); assert.equal(new Set(f.proofs.map(item => item.thumb)).size, 1);
  assert.equal(new Set(f.proofs.map(item => item.jti)).size, f.proofs.length);
  for (const call of f.calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.redirect, 'error'); assert.equal(call.referrerPolicy, 'no-referrer'); }
  const another = await f.session.beginAtprotoOAuth({ ...input, label: 'Second connection' }, f.descriptor);
  await f.session.cancelAtprotoOAuth(another.id); assert.equal(new Set(f.proofs.map(item => item.thumb)).size, 2);
});
Then('Bluesky OAuth restores encrypted proof keys and commits rotating tokens before returning a result', async () => {
  const f = await fixture(), connection = await f.connect(); f.session.lock(); f.session = f.newSession(); await f.session.unlock(f.proof);
  try {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 7200000);
    const binding = await f.binding(connection); await f.session.execute(f.descriptor, {}, binding); assert.equal(f.refreshCalls, 1);
    const stored = JSON.stringify(f.storage.state); for (const secret of f.privateValues) assert.ok(!stored.includes(secret));
    f.session.lock(); f.session = f.newSession(); await f.session.unlock(f.proof); await f.session.execute(f.descriptor, {}, await f.binding(connection)); assert.equal(f.refreshCalls, 1);
    assert.equal(new Set(f.proofs.map(item => item.thumb)).size, 1);
  } finally { vi.useRealTimers(); }
});
Then('Bluesky OAuth consumes callbacks once and drops denied cancelled or locked consent', async () => {
  for (const mode of ['deny', 'wrong-state', 'wrong-issuer', 'cancel', 'lock']) {
    const f = await fixture(), task = await f.session.beginAtprotoOAuth(input, f.descriptor), callback = f.consent(task.authorizationUrl, mode === 'deny');
    if (mode === 'wrong-state') callback.state = 'z'.repeat(43); if (mode === 'wrong-issuer') callback.iss = 'https://other.example.com';
    if (mode === 'cancel') await f.session.cancelAtprotoOAuth(task.id); if (mode === 'lock') f.session.lock();
    await assert.rejects(f.session.completeAtprotoOAuth(task.id, callback), refused); assert.equal(f.tokenCalls, 0);
    await assert.rejects(f.session.completeAtprotoOAuth(task.id, callback), refused);
  }
});
Then('Bluesky OAuth rejects bearer tokens unexpected accounts and excessive or missing scopes', async () => {
  for (const mode of ['legacyType', 'wrongSubject', 'extra-scope', 'missing-scope']) {
    const f = await fixture(); if (mode === 'extra-scope') f.scope += ' transition:generic'; else if (mode === 'missing-scope') f.scope = 'atproto'; else f[mode] = true;
    await assert.rejects(f.connect(), refused); assert.equal(f.tokenCalls, 1); assert.equal(f.resources, 0); assert.deepEqual(await f.session.connections(), []);
  }
});
Then('Bluesky OAuth rejects moved accounts rogue endpoints and private discovery URLs', async () => {
  const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection); f.stalePds = true;
  await assert.rejects(f.session.execute(f.descriptor, {}, binding), refused); assert.equal(f.resources, 0); assert.equal(f.refreshCalls, 0);
  const bad = await fixture(); bad.badMetadata = true; await assert.rejects(bad.connect(), refused); assert.equal(bad.tokenCalls, 0);
  for (const value of ['http://pds.example.com/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://localhost/', 'https://foo.local/', 'https://a:b@pds.example.com/']) assert.throws(() => publicAtprotoUrl(value), refused);
});
Then('Bluesky OAuth persists refresh intent before dispatch and never replays an ambiguous refresh', async () => {
  const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection); f.refreshFailure = true;
  try {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 7200000);
    await assert.rejects(f.session.execute(f.descriptor, {}, binding), refused); assert.equal(f.refreshCalls, 1); assert.equal(f.resources, 0);
    f.session.lock(); f.session = f.newSession(); await f.session.unlock(f.proof);
    await assert.rejects(f.binding(connection), refused); assert.equal(f.refreshCalls, 1);
  } finally { vi.useRealTimers(); }
});
Then('Bluesky OAuth detects concurrent stale state before a second refresh dispatch', async () => {
  const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection);
  try {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 7200000);
    let release; f.onToken = () => new Promise(resolve => { release = resolve; });
    const first = f.session.execute(f.descriptor, {}, binding);
    try {
      for (let i = 0; i < 1000 && !release; i++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.ok(release, 'The first rotation reached the provider');
      await assert.rejects(f.session.execute(f.descriptor, {}, binding), refused); assert.equal(f.refreshCalls, 1);
    } finally { release?.(); }
    await first; assert.equal(f.resources, 1);
  } finally { vi.useRealTimers(); }
});
Then('Bluesky OAuth reconnects the same account and invalidates the previous reference', async () => {
  const f = await fixture(), original = await f.connect(), replacement = await f.connect(httpConnectionReference(original));
  assert.equal(replacement.id, original.id); assert.equal(replacement.revision, original.revision + 1);
  await assert.rejects(f.binding(original), refused); await f.session.execute(f.descriptor, {}, await f.binding(replacement));
  await f.session.removeConnection(httpConnectionReference(replacement)); assert.deepEqual(await f.session.connections(), []);
  await assert.rejects(f.binding(replacement), refused);
});
Then('Bluesky OAuth rejects stale schemas changed operations and manual managed formatting', async () => {
  const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection);
  f.enabled = false; await assert.rejects(f.session.execute(f.descriptor, {}, binding), refused); assert.equal(f.resources, 0);
  assert.throws(() => formatHttpToken('atproto-oauth', 'manual-token'), refused);
  const changed = await approvedOperation({ ...f.descriptor.operation, path: '/xrpc/app.bsky.actor.getProfile' }, f.pds);
  await assert.rejects(f.session.connectionBinding(httpConnectionReference(connection), changed), refused);
});
Then('Bluesky OAuth redacts token echoes and keeps private material out of summaries and copies', async () => {
  const f = await fixture(), connection = await f.connect(); f.echo = true;
  const result = await f.session.execute(f.descriptor, {}, await f.binding(connection)); assert.equal(result.response.redacted, true);
  const summary = await f.session.list(), safe = JSON.stringify({ result, summary, connection, storage: f.storage.state });
  assert.equal(summary[0].oauthState, undefined); for (const value of f.privateValues) assert.ok(!safe.includes(value));
  assert.match(await f.session.copyCredential(summary[0].id), /^[a-f0-9-]{36}$/);
});
Then('Bluesky OAuth handles failed reads and rejects unexpected input or oversized responses', async () => {
  const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection);
  await assert.rejects(f.session.execute(f.descriptor, { forged: 'value' }, binding), refused); assert.equal(f.resources, 0);
  f.resourceFailure = true; await assert.rejects(f.session.execute(f.descriptor, {}, binding));
  assert.ok(f.refreshCalls <= 1);
  const g = await fixture(), saved = await g.connect(), original = g.fetch;
  const client = new VaultSession(g.storage, () => {}, async () => {}, {}, {}, {}, {}, { applicationOrigin: origin, fetchRequest: async request =>
    new URL(request.url).pathname === '/xrpc/app.bsky.actor.getPreferences' ? Response.json({ value: 'x'.repeat(8 * 1024 * 1024) }) : original(request) });
  await client.unlock(g.proof); await assert.rejects(client.execute(g.descriptor, {}, await client.connectionBinding(httpConnectionReference(saved), g.descriptor)), refused);
});
Then('Bluesky OAuth cleans valid duplicate and malformed callback parameters before imports', () => {
  for (const tail of ['&code=private-code', '&code=one&code=two', '&error=access_denied', '&code=one&error=bad']) {
    const updates = [], host = { location: { pathname: '/', search: '?operations_oauth_callback=bluesky&state=' + 'a'.repeat(22) + '&iss=https%3A%2F%2Fauth.example.com' + tail }, history: { replaceState: (...args) => updates.push(args[2]) } };
    const result = takeAtprotoCallback(host); assert.ok(result); assert.deepEqual(updates, ['/?operations_oauth_callback=bluesky']);
    assert.equal(updates[0].includes('private-code'), false); if (tail.includes('&code=two') || tail.includes('&error=bad')) assert.equal(result.state, '');
  }
});
Then('Bluesky OAuth validates same-origin metadata and the virtual loopback development profile', async () => {
  assert.equal(atprotoCallbackUri(origin + '/?query=private#fragment'), redirectUri);
  const page = 'http://127.0.0.1:12345/', local = { ...input, redirectUri: atprotoCallbackUri(page), clientId: atprotoClientId(page) };
  assert.equal(validateAtprotoInput(local, new URL(page).origin).clientId, local.clientId);
  assert.throws(() => validateAtprotoInput({ ...input, clientId: 'https://foreign.example.com/metadata.json' }, origin), refused);
  const f = await fixture(), badInput = { ...input, redirectUri: 'https://foreign.example.com/?operations_oauth_callback=bluesky' };
  await assert.rejects(f.session.beginAtprotoOAuth(badInput, f.descriptor), refused);
  await f.connect(); assert.equal(f.tokenCalls, 1);
  const original = f.fetch, bad = new VaultSession(f.storage, () => {}, async () => {}, {}, {}, {}, {}, { applicationOrigin: origin, fetchRequest: async request => {
    const response = await original(request); if (request.url === input.clientId) response.headers.set('Content-Type', 'text/plain'); return response;
  } });
  await bad.unlock(f.proof); await assert.rejects(bad.beginAtprotoOAuth(input, f.descriptor), refused); assert.equal(f.tokenCalls, 1);
  const metadata = JSON.parse(readFileSync(new URL('./public/oauth/bluesky-client-metadata.json', import.meta.url)));
  assert.equal(metadata.scope, fixtureScope); assert.equal(metadata.token_endpoint_auth_method, 'none'); assert.equal(metadata.dpop_bound_access_tokens, true);
});

Then('Bluesky OAuth rejects a substituted proof key and a saved audience mismatch', async () => {
  const f = await fixture(), connection = await f.connect(), records = await f.session.records(), state = JSON.parse(records[0].oauthState);
  const original = state.tokenSet.aud; state.tokenSet.aud = 'https://foreign.example.com'; records[0].oauthState = JSON.stringify(state);
  await assert.rejects(f.session.save(records), refused); assert.equal(f.resources, 0);
  state.tokenSet.aud = original;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwk = { ...await crypto.subtle.exportKey('jwk', pair.privateKey), alg: 'ES256', kid: crypto.randomUUID() };
  records[0].oauthState = JSON.stringify(state); await f.session.save(records);
  await assert.rejects(f.session.execute(f.descriptor, {}, await f.binding(connection)), refused);
  assert.equal(f.resources, 0); assert.ok(f.calls.some(call => call.url === f.pds + '/xrpc/app.bsky.actor.getPreferences'));
});

Then('Bluesky OAuth preserves the connection limit before and after interactive consent', async () => {
  const f = await fixture(), original = await f.connect(), first = (await f.session.records())[0];
  const task = await f.session.beginAtprotoOAuth({ ...input, label: 'Pending capacity' }, f.descriptor);
  const records = [first];
  for (let i = 1; i < httpConnectionLimit; i++) {
    const id = crypto.randomUUID(), connection = await createAtprotoHttpConnection(f.descriptor, id, 'Capacity ' + i, original.oauth);
    records.push({ ...structuredClone(first), id, label: 'Capacity reference ' + i, value: crypto.randomUUID(), connections: [connection] });
  }
  await f.session.save(records);
  await assert.rejects(f.session.completeAtprotoOAuth(task.id, f.consent(task.authorizationUrl)), error => error instanceof VaultError && error.code === 'LIMIT');
  assert.equal((await f.session.connections()).length, httpConnectionLimit);
  const calls = f.calls.length;
  await assert.rejects(f.session.beginAtprotoOAuth(input, f.descriptor), error => error instanceof VaultError && error.code === 'LIMIT');
  assert.equal(f.calls.length, calls);
  await f.session.removeConnection(httpConnectionReference(original));
  const available = await f.session.beginAtprotoOAuth(input, f.descriptor); await f.session.cancelAtprotoOAuth(available.id);
});

Then('Bluesky saved proof state and registrations reject malformed or mismatched authority', async () => {
  const f = await fixture(), connection = await f.connect(), state = JSON.parse((await f.session.records())[0].oauthState);
  for (const changed of [{ ...state, extra: true }, { ...state, refreshPending: null }, { ...state, jwk: { ...state.jwk, alg: 'none' } },
    { ...state, jwk: { ...state.jwk, d: 'bad' } }, { ...state, tokenSet: { ...state.tokenSet, expires_at: 'not-a-date' } }])
    assert.throws(() => validateAtprotoState(JSON.stringify(changed)), refused);
  assert.throws(() => validateAtprotoState(' '.repeat(65537)), refused);
  assert.throws(() => validateAtprotoState(JSON.stringify(state), { ...state.oauth, accountId: 'did:plc:'+'b'.repeat(24) }), refused);
  assert.deepEqual(managedAtprotoSecrets('malformed'), []);
  assert.throws(() => validateAtprotoMetadata({ ...state.oauth, pds: state.oauth.pds+'unreviewed' }), refused);
  assert.throws(() => validateAtprotoMetadata({ ...state.oauth, scope: 'atproto' }), refused);
  for (const url of [undefined, 'x'.repeat(2049)]) assert.throws(() => publicAtprotoUrl(url), refused);
  assert.throws(() => validateAtprotoInput({ ...input, label: '\u0000' }, origin), refused);
  const page = 'http://127.0.0.1:12345/', local = { ...input, clientId: 'http://localhost?wrong', redirectUri: atprotoCallbackUri(page) };
  assert.throws(() => validateAtprotoInput(local, new URL(page).origin), refused);
  assert.equal(atprotoClientId(origin+'/workspace'), input.clientId);
  for (const changed of [{ ...connection, expiresAt: Date.now()+1000 }, { ...connection, endpoint: 'https://moved.example.com' }]) assert.throws(() => validateHttpConnection(changed), refused);
  assert.equal(atprotoOAuthAlternative({ ...f.descriptor, origin: 'https://127.0.0.1' }), undefined);
  assert.equal(atprotoOAuthAlternative({ ...f.descriptor, operation: { ...f.descriptor.operation, security: [] } }), undefined);
});

Then('Bluesky pending authorization expires and its loopback and ambient runtimes retain private transport', async () => {
  const f = await fixture(), broker = new AtprotoOAuthBroker({ applicationOrigin: origin, fetchRequest: f.fetch }), tasks = [];
  try {
    for (let i = 0; i < 4; i++) tasks.push(await broker.begin(input, f.descriptor, async () => {}));
    await assert.rejects(broker.begin(input, f.descriptor, async () => {}), error => error.code === 'LIMIT');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now()+300001);
    const next = await broker.begin(input, f.descriptor, async () => {}); assert.ok(next.id); broker.cancel(next.id); broker.cancel(next.id);
  } finally { broker.clear(); vi.useRealTimers(); }
  const page = 'http://127.0.0.1:12345/', provider = atprotoProvider(new URL(page).origin);
  const local = new AtprotoOAuthBroker({ applicationOrigin: new URL(page).origin, fetchRequest: provider.fetch });
  try {
    const task = await local.begin({ ...input, clientId: atprotoClientId(page), redirectUri: atprotoCallbackUri(page) }, f.descriptor, async () => {});
    assert.ok(task.authorizationUrl.startsWith(provider.issuer)); local.cancel(task.id);
  } finally { local.clear(); }
  vi.stubGlobal('location', { origin }); vi.stubGlobal('fetch', f.fetch);
  try { const ambient = new AtprotoOAuthBroker(), task = await ambient.begin(input, f.descriptor, async () => {}); ambient.cancel(task.id); }
  finally { vi.unstubAllGlobals(); }
  vi.stubGlobal('location', undefined);
  try { await assert.rejects(new AtprotoOAuthBroker({ fetchRequest: f.fetch }).begin(input, f.descriptor, async () => {}), refused); }
  finally { vi.unstubAllGlobals(); }
});

Then('Bluesky malformed discovery and resource replies never publish private preferences', async () => {
  for (const mode of ['no-body', 'stream-error', 'redirect-response', 'redirected', 'redirected-cancel-reject', 'redirected-null-body', 'empty-par', 'requirements', 'revocation', 'no-revocation', 'pds-service', 'pds-path', 'pds-absolute-id', 'pds-moved']) {
    const f = await fixture(), original = f.fetch; let cancellations = 0, redirectedResponse;
    if (mode === 'pds-moved') f.stalePds = true;
    const broker = new AtprotoOAuthBroker({ applicationOrigin: origin, fetchRequest: async request => {
      const response = await original(request), url = new URL(request.url);
      if (request.url === input.clientId && mode === 'no-body') return new Response(null, { headers: response.headers });
      if (request.url === input.clientId && mode === 'stream-error') return new Response(new ReadableStream({ start(controller) { controller.error(new Error('private stream failure')); } }), { headers: response.headers });
      if (request.url === input.clientId && mode === 'redirect-response') return new Response('Redirect response', {
        status: 302, headers: { Location: 'https://foreign.example.com/metadata', 'Content-Type': 'text/plain' },
      });
      if (request.url === input.clientId && mode.startsWith('redirected')) {
        const body = mode === 'redirected-null-body' ? null : new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('private-redirect-body')); },
          cancel() { cancellations++; if (mode === 'redirected-cancel-reject') throw new Error('private-cancellation-failure'); },
        });
        redirectedResponse = new Response(body, { headers: response.headers });
        Object.defineProperty(redirectedResponse, 'redirected', { value: true });
        return redirectedResponse;
      }
      if (url.pathname === '/par' && response.ok && mode === 'empty-par') return Response.json({ request_uri: '', expires_in: 60 }, { status: response.status, headers: response.headers });
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        const body = await response.json();
        if (mode === 'requirements') body.require_pushed_authorization_requests = false;
        if (mode === 'revocation') body.revocation_endpoint = 'https://foreign.example.com/revoke';
        if (mode === 'no-revocation') delete body.revocation_endpoint;
        return Response.json(body);
      }
      if (url.hostname === 'plc.directory' && ['pds-service', 'pds-path', 'pds-absolute-id'].includes(mode)) {
        const body = await response.json();
        if (mode === 'pds-service') body.service.push({ ...body.service[0] });
        else if (mode === 'pds-absolute-id') body.service[0].id = f.did+'#atproto_pds';
        else body.service[0].serviceEndpoint += '/unreviewed';
        return Response.json(body);
      }
      return response;
    } });
    try {
      if (mode === 'no-revocation' || mode === 'pds-absolute-id') { const task = await broker.begin(input, f.descriptor, async () => {}); broker.cancel(task.id); }
      else await assert.rejects(broker.begin(input, f.descriptor, async () => {}), error => {
        if (!mode.startsWith('redirected')) return refused(error);
        assert.equal(error.code, 'PERMISSION'); assert.equal(error.cause, undefined);
        assert.ok(!error.message.includes('private-')); return true;
      }, 'Discovery variant must reject: '+mode);
      if (mode.startsWith('redirected')) {
        assert.equal(cancellations, mode === 'redirected-null-body' ? 0 : 1);
        assert.equal(redirectedResponse.bodyUsed, mode !== 'redirected-null-body');
      }
      if (mode === 'empty-par') assert.equal(f.pars.size, 1);
      assert.equal(f.tokenCalls, 0); assert.equal(f.resources, 0);
    } finally { broker.clear(); }
  }
  const switched = await fixture(), foreignDid = 'did:plc:'+'b'.repeat(24); switched.wrongSubject = true;
  const account = new AtprotoOAuthBroker({ applicationOrigin: origin, fetchRequest: async request => {
    if (request.url === 'https://plc.directory/'+foreignDid) return Response.json({ id: foreignDid,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: switched.pds }] });
    return switched.fetch(request);
  } });
  try {
    const task = await account.begin(input, switched.descriptor, async () => {});
    await assert.rejects(account.complete(task.id, switched.consent(task.authorizationUrl), async () => {}), refused);
    assert.equal(switched.tokenCalls, 1); assert.equal(switched.resources, 0);
  } finally { account.clear(); }
  const f = await fixture(); await f.connect(); const state = JSON.parse((await f.session.records())[0].oauthState), controller = new AbortController();
  controller.abort(); const broker = new AtprotoOAuthBroker({ applicationOrigin: origin, fetchRequest: f.fetch });
  await assert.rejects(broker.execute(state, f.descriptor, async () => {}, async () => {}, controller.signal), error => error.code === 'CANCELLED');
  const malformed = new AtprotoOAuthBroker({ applicationOrigin: origin, fetchRequest: async request => request.url === f.pds+'/xrpc/app.bsky.actor.getPreferences'
    ? new Response('{}', { headers: { 'Content-Type': 'text/plain' } }) : f.fetch(request) });
  await assert.rejects(malformed.execute(state, f.descriptor, async () => {}, async () => {}), error => error.code === 'NETWORK');
});

Then('Bluesky reconnect and consent reject stale references duplicate names and cancelled callbacks', async () => {
  for (const mode of ['stale', 'duplicate', 'record-name', 'aborted', 'extra-callback']) {
    const f = await fixture(); let previous;
    if (mode === 'stale' || mode === 'duplicate') previous = await f.connect();
    if (mode === 'record-name') await f.session.put(null, { label: input.label+' reference', kind: 'secret', value: 'ordinary-key' });
    const task = await f.session.beginAtprotoOAuth(input, f.descriptor, mode === 'stale' ? httpConnectionReference(previous) : undefined), callback = f.consent(task.authorizationUrl);
    if (mode === 'stale') await f.session.removeConnection(httpConnectionReference(previous));
    if (mode === 'extra-callback') callback.extra = 'unreviewed';
    const controller = new AbortController(); if (mode === 'aborted') controller.abort();
    await assert.rejects(f.session.completeAtprotoOAuth(task.id, callback, controller.signal), refused);
    if (mode === 'aborted' || mode === 'extra-callback') assert.equal(f.tokenCalls, 0);
  }
  const f = await fixture(), connection = await f.connect();
  await assert.rejects(f.session.beginAtprotoOAuth(input, f.descriptor, { ...httpConnectionReference(connection), revision: 2 }), refused);
});

Then('Bluesky private transport policy rejects forged SDK requests and repeated refresh grants', async () => {
  const resource = 'https://pds.example.com/xrpc/app.bsky.actor.getPreferences', endpoint = 'https://auth.example.com/token';
  const policy = { resource, endpoints: new Set([endpoint]), calls: 1 };
  const headers = { DPoP: 'opaque-sdk-proof', Authorization: 'DPoP private-access-value', 'atproto-proxy': atprotoProxy };
  const rejected = [
    new Request(resource, { method: 'POST', headers, body: '' }),
    new Request(resource, { headers: { DPoP: headers.DPoP, 'atproto-proxy': atprotoProxy } }),
    new Request(resource, { headers: { Authorization: headers.Authorization, 'atproto-proxy': atprotoProxy } }),
    new Request(resource, { headers: { ...headers, Authorization: 'Bearer private-access-value' } }),
    new Request(resource, { headers: { ...headers, 'atproto-proxy': 'did:web:foreign.example.com#app' } }),
    new Request(endpoint, { method: 'PUT', headers: { DPoP: headers.DPoP }, body: '' }),
    new Request(endpoint, { method: 'POST', headers: { ...headers }, body: '' }),
    new Request('https://foreign.example.com/token', { method: 'POST', headers: { DPoP: headers.DPoP }, body: '' }),
  ];
  for (const request of rejected) await assert.rejects(validateAtprotoTransport(request, policy), error => error.code === 'PERMISSION');
  await assert.rejects(validateAtprotoTransport(new Request(input.clientId, { headers: { Cookie: 'private-session=value' } }), policy), error => error.code === 'LIMIT');
  await assert.rejects(validateAtprotoTransport(new Request(input.clientId), { ...policy, calls: 65 }), error => error.code === 'LIMIT');
  await assert.rejects(validateAtprotoTransport(new Request(endpoint, { method: 'POST', headers: { DPoP: headers.DPoP }, body: 'x'.repeat(32769) }), policy), error => error.code === 'LIMIT');
  assert.equal((await validateAtprotoTransport(new Request(resource, { headers }), policy)).resource, true);
  assert.equal((await validateAtprotoTransport(new Request(input.clientId), policy)).resource, false);
  assert.equal((await validateAtprotoTransport(new Request(endpoint, { method: 'POST', headers: { DPoP: headers.DPoP }, body: 'grant_type=refresh_token' }), policy)).refreshing, true);
  for (const [available, dispatched, nonceRetry] of [[false, false, false], [true, true, false]])
    assert.throws(() => validateAtprotoRefresh(available, dispatched, nonceRetry), error => error.code === 'AUTHORIZATION');
  validateAtprotoRefresh(true, false, false); validateAtprotoRefresh(true, true, true);
});

Then('Bluesky continuation policy preserves the selected account registration and proof key', async () => {
  const f = await fixture(); await f.connect(); const state = JSON.parse((await f.session.records())[0].oauthState);
  assert.deepEqual(validateAtprotoContinuation(f.did, state.tokenSet, state.jwk, state.oauth, f.did, state), state);
  const foreignDid = 'did:plc:'+'b'.repeat(24);
  assert.throws(() => validateAtprotoContinuation(foreignDid, { ...state.tokenSet, sub: foreignDid }, state.jwk, { ...state.oauth, accountId: foreignDid }, f.did, state), refused);
  assert.throws(() => validateAtprotoContinuation(f.did, { ...state.tokenSet, sub: foreignDid }, state.jwk, state.oauth, f.did, state), refused);
  assert.throws(() => validateAtprotoContinuation(f.did, state.tokenSet, state.jwk, { ...state.oauth, clientId: origin+'/oauth/changed.json' }, f.did, state), refused);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.privateKey), alg: 'ES256', kid: crypto.randomUUID() };
  assert.throws(() => validateAtprotoContinuation(f.did, state.tokenSet, jwk, state.oauth, f.did, state), refused);
});

Then('Bluesky invalid refresh replies and disconnect during rotation cannot recreate authority', async () => {
  for (const mode of ['invalid-grant', 'malformed-nonce', 'disconnect']) {
    const f = await fixture(), connection = await f.connect(), binding = await f.binding(connection);
    try {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now()+7200000);
      if (mode === 'disconnect') {
        f.onToken = () => f.session.removeConnection(httpConnectionReference(connection));
        await assert.rejects(f.session.execute(f.descriptor, {}, binding), refused);
        assert.deepEqual(await f.session.connections(), []); assert.equal(f.refreshCalls, 1);
      } else {
        const state = JSON.parse((await f.session.records())[0].oauthState), writes = []; let attempts = 0;
        const broker = new AtprotoOAuthBroker({ applicationOrigin: origin, fetchRequest: async request => {
          if (new URL(request.url).pathname === '/token' && new URLSearchParams(await request.clone().text()).get('grant_type') === 'refresh_token') {
            attempts++;
            return mode === 'invalid-grant' ? Response.json({ error: 'invalid_grant' }, { status: 400 })
              : new Response('{', { status: 400, headers: { 'Content-Type': 'application/json', 'DPoP-Nonce': 'private-nonce' } });
          }
          return f.fetch(request);
        } });
        await assert.rejects(broker.execute(state, f.descriptor, async () => {}, async next => { writes.push(next); }), refused);
        assert.equal(attempts, 1); assert.ok(writes.length); assert.equal(writes.at(-1).refreshPending, true);
      }
      assert.equal(f.resources, 0);
    } finally { vi.useRealTimers(); }
  }
  const f = await fixture(), wrong = await approvedOperation({ ...f.descriptor.operation, path: '/xrpc/app.bsky.actor.putPreferences', method: 'POST' }, f.pds);
  await assert.rejects(f.session.beginAtprotoOAuth(input, wrong), error => error.code === 'PERMISSION');
  const connection = await f.connect(), binding = await f.binding(connection), records = await f.session.records();
  delete records[0].oauthState; await f.session.save(records);
  await assert.rejects(f.binding(connection), refused); await assert.rejects(f.session.execute(f.descriptor, {}, binding), refused);
  assert.equal(f.resources, 0);
  const late = await fixture(), saved = await late.connect(), selected = await late.binding(saved), controller = new AbortController();
  const execute = AtprotoOAuthBroker.prototype.execute, before = structuredClone(late.storage.state);
  const spy = vi.spyOn(AtprotoOAuthBroker.prototype, 'execute').mockImplementation(async function (...args) {
    const result = await execute.apply(this, args); controller.abort(); return result;
  });
  try {
    await assert.rejects(late.session.execute(late.descriptor, {}, selected, controller.signal), error => error.code === 'CANCELLED');
    assert.equal(spy.mock.calls.length, 1);
  } finally { spy.mockRestore(); }
  assert.deepEqual(late.storage.state, before); assert.deepEqual(await late.session.connections(), [saved]);
  assert.equal(late.resources, 1); assert.equal(late.refreshCalls, 0);
  const calls = late.calls.length;
  await assert.rejects(late.session.execute(late.descriptor, {}, selected, controller.signal), error => error.code === 'CANCELLED');
  assert.equal(late.calls.length, calls); assert.equal(late.resources, 1);
});
