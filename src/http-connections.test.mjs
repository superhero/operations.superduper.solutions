// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { VaultSession } from './lib/secrets/session.ts';
import { VaultError } from './lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { validateCredentialBinding, validateHttpConnectionReference, uploadSessionSelection } from './lib/secrets/bindings.ts';
import { createHttpConnection, httpConnectionReference, connectionCredentialIds, resolveHttpConnection, formatHttpToken,
  validateHttpConnection, storedHttpConnections, httpTokenFormats, invalidateHttpConnections,
  createGitlabHttpConnection, createJiraHttpConnection, createAtprotoHttpConnection } from './lib/secrets/http-connections.ts';
import { createConnectionAuthorization } from './lib/secrets/connection-lifecycle.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { portableWorkflowDocument, validateWorkflowDocument } from './lib/workflow-document.ts';

const code = expected => error => error instanceof VaultError && error.code === expected;
const origin = 'https://connections.example.test/v1';
const secretA = 'CONNECTION-PRIVATE-A-5729', secretB = 'CONNECTION-PRIVATE-B-5729';
const scheme = kind => ({ name: 'Service', kind, header: kind === 'apiKey' ? 'X-Api-Key' : 'Authorization' });
const descriptor = (kind = 'bearer', extra = {}, endpoint = origin) => approvedOperation({ id: 'connections:read', name: 'Read', description: '',
  group: 'Connections', method: 'GET', path: '/read', fields: [], bodyRequired: false, responseMediaType: 'application/json', security: [[scheme(kind)]], ...extra }, endpoint);
async function fixture() {
  const key = await newVaultKey(), id = crypto.randomUUID(), methodId = crypto.randomUUID(), recovery = randomBase64(128), salt = randomBase64(16);
  const envelope = { id: methodId, kind: 'recovery', revision: 1, salt,
    wrappedKey: await wrapVaultKey(key, await recoveryKey(recovery, salt), { vaultId: id, epoch: 1, kind: 'recovery', id: methodId, revision: 1 }) };
  const storage = { state: { revision: 1, lockEpoch: 1, snapshot: await sealSnapshot({ id, epoch: 1, revision: 1, envelopes: [envelope], records: [] }, key) },
    async read() { return structuredClone(this.state); },
    async replace(expected, snapshot, keys) {
      if (expected.revision !== this.state.revision || expected.lockEpoch !== this.state.lockEpoch) throw new VaultError('CONFLICT');
      this.state = { revision: this.state.revision + 1, lockEpoch: this.state.lockEpoch + 1, snapshot: structuredClone(snapshot), keys: structuredClone(keys) };
      return this.read();
    },
    async indexKeys(expected, keys) { assert.equal(expected.revision, this.state.revision); this.state.keys = structuredClone(keys); return this.read(); },
    async lock() { this.state.revision++; this.state.lockEpoch++; return this.read(); } };
  const proof = { methodId, secret: recovery };
  let enabled = true;
  const session = new VaultSession(storage, undefined, async () => { if (!enabled) throw new VaultError('PERMISSION'); });
  await session.unlock(proof);
  await session.put(null, { label: 'First stored key', kind: 'secret', value: secretA });
  const list = await session.put(null, { label: 'Second stored key', kind: 'secret', value: secretB });
  return { session, storage, proof, ids: list.map(item => item.id), disable() { enabled = false; } };
}
const manual = (approved, ids, kind = 'bearer', alternative = 0) => ({ alternative, fingerprint: approved.fingerprint,
  credentials: { Service: kind === 'basic' ? { username: ids[0], password: ids[1] } : ids[0] } });
const input = (label = 'Saved account', account = 'Account A') => ({ label, account, format: 'schema' });
async function fetched(action) {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ accepted: true }); };
  try { await action(requests); } finally { globalThis.fetch = previous; }
}

Then('a saved {string} connection survives reload and re-unlock without plaintext metadata or values', async kind => {
  const f = await fixture(), approved = await descriptor(kind), legacy = manual(approved, f.ids, kind);
  const connection = await f.session.putConnection(input(), approved, legacy), reference = httpConnectionReference(connection);
  const binding = await f.session.connectionBinding(reference, approved);
  assert.deepEqual(binding.credentials, {}); assert.equal(binding.connection.id, connection.id);
  assert.ok(!JSON.stringify(f.storage.state).includes('Saved account'));
  for (const value of [secretA, secretB, 'Account A']) assert.ok(!JSON.stringify(f.storage.state).includes(value));
  const backup = await f.session.backup(); assert.ok(!backup.includes(secretA)); assert.ok(!backup.includes(connection.id));
  f.session.lock(); await assert.rejects(f.session.connections(), code('LOCKED'));
  const reloaded = new VaultSession(f.storage); await reloaded.unlock(f.proof);
  assert.deepEqual(await reloaded.connections(), [connection]);
  const selection = validateCredentialBinding(JSON.parse(JSON.stringify(binding)));
  await fetched(async calls => {
    await reloaded.execute(approved, {}, selection); await reloaded.execute(approved, {}, legacy);
    assert.equal(calls.length, 2);
    const expected = kind === 'basic' ? 'Basic '+btoa(secretA+':'+secretB) : kind === 'bearer' ? 'Bearer '+secretA : secretA;
    assert.equal(calls[0].init.headers.get(kind === 'apiKey' ? 'X-Api-Key' : 'Authorization'), expected);
    await reloaded.removeConnection(reference);
    await assert.rejects(reloaded.execute(approved, {}, selection), code('PERMISSION'));
    assert.equal(calls.length, 2);
  });
});

Then('edited HTTP connections reject stale references while other accounts remain isolated', async () => {
  const f = await fixture(), a = await descriptor(), credentials = manual(a, f.ids);
  const original = await f.session.putConnection(input(), a, credentials);
  const other = await f.session.putConnection(input('Second account', 'Account B'), a, manual(a, [f.ids[1]]));
  const old = await f.session.connectionBinding(httpConnectionReference(original), a);
  const independent = await f.session.connectionBinding(httpConnectionReference(other), a);
  let current = await f.session.putConnection({ ...input(), account: 'Changed account', reference: httpConnectionReference(original) }, a, credentials);
  assert.equal(current.revision, original.revision + 1); assert.notEqual(current.fingerprint, original.fingerprint);
  await fetched(async calls => {
    await assert.rejects(f.session.execute(a, {}, old), code('PERMISSION')); assert.equal(calls.length, 0);
    await f.session.execute(a, {}, independent); assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer '+secretB);
    const moved = await descriptor('bearer', {}, 'https://other.example.test/v1');
    current = await f.session.putConnection({ ...input(), reference: httpConnectionReference(current) }, moved, manual(moved, f.ids));
    await assert.rejects(f.session.connectionBinding(httpConnectionReference(current), a), code('PERMISSION'));
    const alternatives = await descriptor('bearer', { security: [[], [scheme('bearer')]] }, moved.origin);
    current = await f.session.putConnection({ ...input(), reference: httpConnectionReference(current) }, alternatives, manual(alternatives, f.ids, 'bearer', 1));
    await assert.rejects(f.session.connectionBinding(httpConnectionReference(current), moved), code('PERMISSION'));
    const selected = await f.session.connectionBinding(httpConnectionReference(current), alternatives);
    await f.session.execute(alternatives, {}, selected); assert.equal(calls.length, 2);
    await f.session.put(null, { id: f.ids[0], label: 'Rotated token', kind: 'secret', value: 'ROTATED-CONNECTION-TOKEN' });
    await assert.rejects(f.session.execute(alternatives, {}, selected), code('PERMISSION')); assert.equal(calls.length, 2);
    f.disable(); await assert.rejects(f.session.connectionBinding(httpConnectionReference(current), alternatives), code('PERMISSION'));
  });
});

Then('native Bot and GenieKey formats are restricted to reviewed endpoints and are scrubbed before returning', async () => {
  for (const [provider, id, format, prefix] of [['discord', 'get_my_user', 'discord-bot', 'Bot'], ['opsgenie', 'GET /v2/account', 'opsgenie-key', 'GenieKey']]) {
    const doc = await readServiceSchema(provider), operation = inspectServiceSchema(doc, provider).operations.find(item => item.id === provider+':'+id);
    assert.ok(operation); const approved = await approvedOperation(operation, doc.servers[0].url);
    const key = { id: crypto.randomUUID(), label: 'Token', kind: 'secret', value: secretA, grants: [] };
    const selection = { alternative: 0, credentials: { [operation.security[0][0].name]: key.id }, fingerprint: approved.fingerprint };
    const connection = await createHttpConnection({ ...input(), format }, approved, selection, [key]); key.connections = [connection];
    const binding = { alternative: 0, credentials: {}, fingerprint: approved.fingerprint, connection: httpConnectionReference(connection) };
    let calls = 0;
    const result = await executeCredentialed(approved, {}, binding, [key], { assertCurrent() {}, fetchRequest: async (_url, init) => {
      calls++; assert.equal(init.headers.get('Authorization'), prefix+' '+secretA);
      return Response.json({ echo: prefix+' '+secretA });
    } });
    assert.equal(calls, 1); assert.equal(result.response.redacted, true); assert.ok(!JSON.stringify(result).includes(secretA));
    const changed = await approvedOperation(operation, 'https://unreviewed.example.test');
    await assert.rejects(createHttpConnection({ ...input(), format }, changed, { ...selection, fingerprint: changed.fingerprint }, [key]), code('PERMISSION'));
    assert.throws(() => formatHttpToken(format, prefix+' '+secretA), code('INVALID'));
  }
});

Then('connection metadata and opaque bindings reject tampering and portable workflows strip local references', async () => {
  const f = await fixture(), a = await descriptor(), connection = await f.session.putConnection(input(), a, manual(a, f.ids));
  const binding = await f.session.connectionBinding(httpConnectionReference(connection), a), reference = binding.connection;
  let getters = 0; const getter = { ...reference }; Object.defineProperty(getter, 'id', { enumerable: true, get() { getters++; return reference.id; } });
  for (const invalid of [{ ...reference, id: 'raw-secret' }, { ...reference, revision: 0 }, { ...reference, fingerprint: 'bad' },
    { ...reference, token: secretA }, Object.create(reference), getter]) assert.throws(() => validateHttpConnectionReference(invalid), code('INVALID'));
  assert.equal(getters, 0);
  assert.throws(() => validateCredentialBinding({ ...binding, credentials: { Service: f.ids[0] } }), code('INVALID'));
  const records = [{ id: connectionCredentialIds(connection)[0], kind: 'secret', value: secretA, label: 'Key', grants: [], connections: [connection] }];
  for (const changed of [{ ...connection, account: 'Forged account' }, { ...connection, format: 'discord-bot' }, { ...connection, endpoint: 'https://evil.example.test' }]) {
    await assert.rejects(resolveHttpConnection(a, { ...binding, connection: httpConnectionReference(changed) }, [{ ...records[0], connections: [changed] }]), code('PERMISSION'));
  }
  const document = validateWorkflowDocument({ version: 3, id: 'connections', name: 'Connections', nodes: [{ id: 'op', type: 'operation', position: { x: 0, y: 0 },
    data: { operationId: a.operation.id, name: 'Read', description: '', method: 'GET', path: '/read', credentialBinding: binding } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false });
  assert.deepEqual(validateWorkflowDocument(JSON.parse(JSON.stringify(document))).nodes[0].data.credentialBinding, binding);
  assert.ok(!JSON.stringify(portableWorkflowDocument(document)).includes(connection.id));
  assert.ok(!JSON.stringify(document).includes(secretA));
});

Then('removed credentials and expired HTTP connections fail without exposing a result', async () => {
  const f = await fixture(), a = await descriptor(), connection = await f.session.putConnection(input(), a, manual(a, f.ids));
  const selection = await f.session.connectionBinding(httpConnectionReference(connection), a);
  await f.session.remove(null, f.ids[0]); assert.deepEqual(await f.session.connections(), []);
  await fetched(async calls => { await assert.rejects(f.session.execute(a, {}, selection), code('PERMISSION')); assert.equal(calls.length, 0); });
  const expiresAt = Date.now()+10_000;
  const next = await f.session.putConnection({ ...input(), expiresAt }, a, manual(a, [f.ids[1]]));
  const binding = await f.session.connectionBinding(httpConnectionReference(next), a);
  // The private executor must also withhold a response that completes after expiry.
  const key = { id: f.ids[1], kind: 'secret', value: secretB, label: 'B', grants: [], connections: [next] };
  vi.useFakeTimers();
  try {
    await assert.rejects(executeCredentialed(a, {}, binding, [key], { assertCurrent() {}, fetchRequest: async () => {
      vi.setSystemTime(expiresAt+1); return Response.json({ accepted: true });
    } }), code('PERMISSION'));
    await assert.rejects(f.session.connectionBinding(httpConnectionReference(next), a), code('PERMISSION'));
  } finally { vi.useRealTimers(); }
  const basic = await fixture(), d = await descriptor('basic');
  const profile = await basic.session.putConnection(input(), d, manual(d, basic.ids, 'basic'));
  const stale = await basic.session.connectionBinding(httpConnectionReference(profile), d);
  await basic.session.remove(null, basic.ids[1]); assert.deepEqual(await basic.session.connections(), []);
  assert.deepEqual((await basic.session.list()).map(item => item.id), [basic.ids[0]]);
  await fetched(async calls => { await assert.rejects(basic.session.execute(d, {}, stale), code('PERMISSION')); assert.equal(calls.length, 0); });
});

Then('a synthetic connection can wait authorize cancel expire and reject late account completions', async () => {
  vi.useFakeTimers();
  try {
    const states = [], reference = { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) };
    const lifecycle = createConnectionAuthorization(state => states.push(state));
    let done; const pending = new Promise(resolve => { done = resolve; });
    const waiting = lifecycle.start(reference, async () => pending, { enabled: true });
    await vi.advanceTimersByTimeAsync(20_000); assert.equal(lifecycle.state.kind, 'waiting');
    done('ready'); assert.equal(await waiting, 'ready'); assert.equal(lifecycle.state.kind, 'ready');
    let late; const old = lifecycle.start(reference, () => new Promise(resolve => { late = resolve; }), { enabled: true });
    lifecycle.cancel(); assert.equal(await old, undefined); late('late account'); await Promise.resolve(); assert.equal(lifecycle.state.kind, 'cancelled');
    const next = { ...reference, id: crypto.randomUUID() }, expiresAt = Date.now()+500;
    await lifecycle.start(next, async () => 'new account', { enabled: true, expiresAt });
    assert.equal(lifecycle.state.reference.id, next.id); await vi.advanceTimersByTimeAsync(501); assert.equal(lifecycle.state.kind, 'expired');
    const expired = lifecycle.start(reference, () => new Promise(() => {}), { enabled: true, waitMs: 100 });
    await vi.advanceTimersByTimeAsync(101); assert.equal(await expired, undefined); assert.equal(lifecycle.state.kind, 'expired');
    await lifecycle.start(reference, async () => { throw new Error(secretA); }, { enabled: true });
    assert.equal(lifecycle.state.kind, 'failed'); assert.ok(!JSON.stringify(states).includes(secretA));
    lifecycle.reset(); assert.equal(lifecycle.state.kind, 'needs-action');
  } finally { vi.useRealTimers(); }
});

Then('a disabled connection initializes no SDK probe or native process', async () => {
  let initialized = 0;
  const lifecycle = createConnectionAuthorization(() => {});
  const reference = { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) };
  await lifecycle.start(reference, async () => { initialized++; return 'provider'; }, { enabled: false });
  assert.equal(initialized, 0); assert.equal(lifecycle.state.kind, 'needs-action');
});

Then('stored HTTP profiles reject malformed metadata ownership and security before selection', async () => {
  const approved = await descriptor(), id = crypto.randomUUID(), record = { id, kind: 'secret', value: secretA, label: 'A', grants: [] };
  const saved = await createHttpConnection(input(), approved, manual(approved, [id]), [record]);
  const mutations = [
    value => { delete value.label; }, value => { value.extra = true; }, value => { value.account = '\u0000'; },
    value => { value.endpoint = 'not a URL'; }, value => { value.endpoint = 'ftp://connections.example.test'; },
    value => { value.endpoint = 'https://user@connections.example.test'; }, value => { value.endpoint += '/'; },
    value => { value.security = []; }, value => { value.security = [{ name: 'Service', kind: 'unsupported', header: 'Authorization' }]; },
    value => { value.security[0] = { name: 'Service', kind: 'oauth1', header: 'Authorization', profile: 'unreviewed' }; },
    value => { value.security[0] = { name: 'Service', kind: 'aws-sigv4', header: 'Authorization', profile: 'unreviewed' }; },
    value => { value.security[0].name = 42; }, value => { value.security[0].header = 42; },
    value => { value.credentials = {}; }, value => { value.credentials.Extra = crypto.randomUUID(); }, value => { value.oauth = {}; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(saved); mutate(changed); assert.throws(() => validateHttpConnection(changed), code('INVALID'));
  }
  assert.throws(() => storedHttpConnections([{ ...record, id: crypto.randomUUID(), connections: [saved] }]), code('INVALID'));
  assert.throws(() => storedHttpConnections([{ ...record, connections: [saved, saved] }]), code('LIMIT'));
  assert.throws(() => storedHttpConnections([{ ...record, connections: Array.from({ length: 129 }, () => ({ ...saved, id: crypto.randomUUID() })) }]), code('LIMIT'));
  assert.deepEqual(httpTokenFormats({ ...approved, operation: { ...approved.operation, security: [] } }, 0), ['schema']);
  assert.equal(uploadSessionSelection(undefined, crypto.randomUUID()), undefined);
  assert.equal(uploadSessionSelection([[scheme('bearer')]], crypto.randomUUID()), undefined);
  assert.equal(validateHttpConnection({ ...saved, security: [{ name: 'Service', kind: 'apiKey', query: 'api_key' }] }).security[0].query, 'api_key');
});

Then('HTTP profile edits reject stale capacity duplicate labels and incompatible credential parts', async () => {
  const approved = await descriptor(), id = crypto.randomUUID(), record = { id, kind: 'secret', value: secretA, label: 'A', grants: [] };
  const selected = manual(approved, [id]), saved = await createHttpConnection(input(), approved, selected, [record]); record.connections = [saved];
  for (const reference of [{ ...httpConnectionReference(saved), revision: 2 }, { ...httpConnectionReference(saved), fingerprint: '0'.repeat(64) },
    { ...httpConnectionReference(saved), id: crypto.randomUUID() }])
    await assert.rejects(createHttpConnection({ ...input(), reference }, approved, selected, [record]), code('CONFLICT'));
  await assert.rejects(createHttpConnection(input('  SAVED ACCOUNT  '), approved, selected, [record]), code('DUPLICATE_KEY'));
  const exhausted = { ...saved, revision: Number.MAX_SAFE_INTEGER };
  await assert.rejects(createHttpConnection({ ...input(), reference: httpConnectionReference(exhausted) }, approved, selected, [{ ...record, connections: [exhausted] }]), code('LIMIT'));
  await assert.rejects(invalidateHttpConnections([{ ...record, connections: [exhausted] }], id), code('LIMIT'));
  const full = [{ ...record, connections: Array.from({ length: 128 }, (_, n) => ({ ...saved, id: crypto.randomUUID(), label: 'Existing '+n })) }];
  await assert.rejects(createHttpConnection(input('One more'), approved, selected, full), code('LIMIT'));
  const untouched = [{ ...record, connections: [saved] }];
  await invalidateHttpConnections(untouched, crypto.randomUUID()); assert.deepEqual(untouched[0].connections, [saved]);
  await assert.rejects(createHttpConnection(input('Wrong credential type'), approved, selected, [{ ...record, kind: 'basic', connections: undefined }]), code('PERMISSION'));
  for (const kind of ['basic', 'bearer']) {
    const target = await descriptor(kind);
    const wrong = kind === 'basic' ? manual(target, [id]) : manual(target, [id, crypto.randomUUID()], 'basic');
    await assert.rejects(createHttpConnection(input('Wrong parts'), target, wrong, [record]), code('PERMISSION'));
  }
  await assert.rejects(createGitlabHttpConnection(approved, id, 'GitLab', 'user', {}), code('PERMISSION'));
  await assert.rejects(createJiraHttpConnection(approved, id, 'Jira', {}), code('PERMISSION'));
  await assert.rejects(createAtprotoHttpConnection(approved, id, 'Bluesky', {}), code('PERMISSION'));
});

Then('connection authorization rejects invalid deadlines and suppresses expired or abandoned completion', async () => {
  vi.useFakeTimers();
  try {
    const states = [], reference = { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) };
    let now = Date.now(), initialized = 0;
    const lifecycle = createConnectionAuthorization(state => states.push(state), () => now);
    for (const options of [{ waitMs: 0 }, { waitMs: 300001 }, { waitMs: 1.5 }, { expiresAt: NaN }]) {
      await lifecycle.start(reference, async () => { initialized++; }, { enabled: true, ...options }); assert.equal(lifecycle.state.kind, 'failed');
    }
    await lifecycle.start(reference, async () => { initialized++; }, { enabled: true, expiresAt: now });
    assert.equal(lifecycle.state.kind, 'expired'); assert.equal(initialized, 0);
    assert.equal(await lifecycle.start(reference, async () => { now += 100; return secretA; }, { enabled: true, expiresAt: now+50 }), undefined);
    assert.equal(lifecycle.state.kind, 'expired');
    let rejectOld;
    const old = lifecycle.start(reference, () => new Promise((_resolve, reject) => { rejectOld = reject; }), { enabled: true });
    lifecycle.reset(); rejectOld(new Error(secretA)); assert.equal(await old, undefined); assert.equal(lifecycle.state.kind, 'needs-action');
    const expiry = now + 2_147_483_648;
    assert.equal(await lifecycle.start(reference, async () => 'ready', { enabled: true, expiresAt: expiry }), 'ready');
    now += 2_147_483_647; await vi.advanceTimersByTimeAsync(2_147_483_647); assert.equal(lifecycle.state.kind, 'ready');
    now++; await vi.advanceTimersByTimeAsync(1); assert.equal(lifecycle.state.kind, 'expired');
    assert.ok(!JSON.stringify(states).includes(secretA));
  } finally { vi.useRealTimers(); }
});

Then('authorization observers may cancel readiness without reviving expiry or failure state', async () => {
  vi.useFakeTimers();
  try {
    const states = [], reference = { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) };
    const lifecycle = createConnectionAuthorization(state => { states.push(state); if (state.kind === 'ready') lifecycle.cancel(); });
    await lifecycle.start(reference, async () => 'account', { enabled: true, expiresAt: Date.now()+100 });
    assert.equal(lifecycle.state.kind, 'cancelled'); await vi.advanceTimersByTimeAsync(101); assert.equal(lifecycle.state.kind, 'cancelled');
    await lifecycle.start(reference, async () => { lifecycle.cancel(); throw new Error(secretA); }, { enabled: true });
    assert.equal(lifecycle.state.kind, 'cancelled'); assert.equal(states.some(state => state.kind === 'failed'), false);
    assert.ok(!JSON.stringify(states).includes(secretA));
  } finally { vi.useRealTimers(); }
});

Then('malformed stored connection lists and OAuth payloads fail before vault state changes', async () => {
  const f = await fixture(), records = await f.session.records(), before = structuredClone(f.storage.state);
  for (const changed of [{ ...records[0], connections: {} }, { ...records[0], connections: Array(33).fill({}) },
    { ...records[0], oauthState: {} }, { ...records[0], oauthState: 'a'.repeat(16385) }, { ...records[0], oauthState: '{}' }])
    await assert.rejects(f.session.save([changed, records[1]]), error => error instanceof VaultError);
  assert.deepEqual(f.storage.state, before);
  const approved = await descriptor(), saved = await f.session.putConnection(input(), approved, manual(approved, f.ids));
  await assert.rejects(f.session.connectionBinding(httpConnectionReference(saved), { ...approved, fingerprint: '0'.repeat(64) }), code('PERMISSION'));
  await assert.rejects(f.session.removeConnection({ ...httpConnectionReference(saved), revision: 2 }), code('CONFLICT'));
  await f.session.removeConnection(httpConnectionReference(saved));
  const basic = await descriptor('basic'), connection = await f.session.putConnection(input('Basic account'), basic, manual(basic, f.ids, 'basic'));
  const selected = await f.session.connectionBinding(httpConnectionReference(connection), basic), [owner, other] = connectionCredentialIds(connection);
  await f.session.remove(null, other);
  assert.equal((await f.session.list()).some(record => record.id === owner), true);
  assert.deepEqual(await f.session.connections(), []);
  await fetched(async calls => { await assert.rejects(f.session.execute(basic, {}, selected), code('PERMISSION')); assert.equal(calls.length, 0); });
});
