// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { VaultSession } from './lib/secrets/session.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { decryptJSON, encryptJSON, passwordKey, randomBase64, recoveryKey, unwrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { VaultError, vaultLimits } from './lib/secrets/types.ts';

const code = expected => error => error instanceof VaultError && error.code === expected && !Object.hasOwn(error, 'cause');
// Lifecycle scenarios perform the production 64 MiB Argon2 profile repeatedly.
// Allow bounded headroom for coverage instrumentation and concurrent browser checks.
const kdfStep = { timeout: 90_000 };
const password = 'session synthetic password';
const clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
class MemoryStorage {
  state = { revision: 0, lockEpoch: 0, snapshot: null };
  writes = 0;
  readHook;
  replaceHook;
  async read() {
    const hook = this.readHook; this.readHook = undefined;
    if (hook) await hook();
    return clone(this.state);
  }
  async replace(expected, snapshot) {
    const hook = this.replaceHook; this.replaceHook = undefined;
    if (hook) await hook();
    if (expected.revision !== this.state.revision || expected.lockEpoch !== this.state.lockEpoch) throw new VaultError('CONFLICT');
    this.writes++;
    this.state = { revision: this.state.revision + 1, lockEpoch: this.state.lockEpoch + 1, snapshot: clone(snapshot) };
    return clone(this.state);
  }
  async lock() {
    this.state.revision++; this.state.lockEpoch++;
    return clone(this.state);
  }
}
async function created(assertActive, assertSchema) {
  const storage = new MemoryStorage(), session = new VaultSession(storage, assertActive, assertSchema);
  const recovery = await session.prepareCreate(password);
  const status = await session.confirmCreate(recovery);
  const passwordProof = { methodId: status.methods.find(method => method.kind === 'password').id, secret: password };
  const recoveryProof = { methodId: status.methods.find(method => method.kind === 'recovery').id, secret: recovery };
  return { storage, session, recovery, passwordProof, proof: recoveryProof };
}
async function descriptor(kind = 'bearer') {
  return approvedOperation({ id: 'vault-session-read', title: 'Read service', method: 'GET', path: '/items', fields: [],
    security: [[{ name: 'service', kind, header: kind === 'bearer' ? 'Authorization' : 'X-API-Key' }]] }, 'https://vault-test.example/api');
}
async function populated() {
  const fixture = await created();
  const list = await fixture.session.put(fixture.proof, { label: 'Private account', kind: 'bearer', value: 'SYNTHETIC-PRIVATE-TOKEN' });
  const approval = await descriptor();
  await fixture.session.grant(fixture.proof, list[0].id, 'service', approval);
  return { ...fixture, id: list[0].id, approval };
}
async function retainedProofs(fixture) {
  const prf = new Uint8Array(32).fill(9);
  const enrolled = await fixture.session.addMethod(fixture.proof, {
    kind: 'passkey', prf, credentialId: randomBase64(48), prfSalt: randomBase64(32),
  });
  return [fixture.proof, fixture.passwordProof, {
    methodId: enrolled.methods.find(method => method.kind === 'passkey').id, prf,
  }];
}
async function rawKey(snapshot, proof) {
  const envelope = snapshot.envelopes.find(item => item.id === proof.methodId);
  const kek = envelope.kind === 'password' ? await passwordKey(proof.secret, envelope.salt, envelope.profile)
    : await recoveryKey(proof.secret, envelope.salt);
  return unwrapVaultKey(envelope.wrappedKey, kek, { vaultId: snapshot.id, epoch: snapshot.epoch, kind: envelope.kind,
    id: envelope.id, revision: envelope.revision });
}
async function tamperedRecord(fixture, mutate) {
  const snapshot = fixture.storage.state.snapshot, key = await rawKey(snapshot, fixture.proof), record = snapshot.records[0];
  const context = { vaultId: snapshot.id, epoch: snapshot.epoch, kind: record.kind, id: record.id, revision: record.revision };
  const value = await decryptJSON(key, record.ciphertext, context);
  const next = mutate(value) ?? value;
  const records = [{ ...record, ciphertext: await encryptJSON(key, next, context) }];
  return sealSnapshot({ id: snapshot.id, epoch: snapshot.epoch, revision: snapshot.revision,
    envelopes: snapshot.envelopes, records }, key);
}

Then('a vault session persists creation only after the exact recovery key is confirmed', kdfStep, async () => {
  const password = 'tri';
  const storage = new MemoryStorage(), session = new VaultSession(storage);
  assert.deepEqual(await session.status(), { exists: false, unlocked: false, revision: 0, epoch: 0, methods: [] });
  await assert.rejects(session.unlock({ methodId: crypto.randomUUID(), secret: password }), code('LOCKED'));
  await assert.rejects(session.confirmCreate('not prepared'), code('AUTHENTICATION'));
  for (const tooShort of ['', 'a', 'ab']) await assert.rejects(session.prepareCreate(tooShort), code('INVALID'));
  const recovery = await session.prepareCreate(password);
  assert.equal(Buffer.from(recovery, 'base64').length, 32);
  assert.equal(storage.writes, 0);
  assert.equal((await session.status()).exists, false);
  await assert.rejects(session.confirmCreate('not the recovery key'), code('AUTHENTICATION'));
  assert.equal(storage.writes, 0);
  const status = await session.confirmCreate(recovery);
  assert.equal(status.exists, true); assert.equal(status.unlocked, true);
  assert.deepEqual(status.methods.map(method => method.kind), ['password', 'recovery']);
  assert.ok(!JSON.stringify(storage.state).includes(password));
  assert.ok(!JSON.stringify(storage.state).includes(recovery));
  await assert.rejects(session.confirmCreate(recovery), code('AUTHENTICATION'));
  await assert.rejects(session.prepareCreate(password), code('CONFLICT'));
});

Then('vault sessions authenticate password and recovery while failed unlock leaves the session locked', kdfStep, async () => {
  const { session, passwordProof, proof } = await created();
  session.lock();
  await assert.rejects(session.list(), code('LOCKED'));
  assert.equal((await session.unlock(passwordProof)).unlocked, true);
  assert.deepEqual(await session.list(), []);
  await assert.rejects(session.unlock({ ...passwordProof, secret: 'wrong password' }), code('AUTHENTICATION'));
  assert.equal((await session.status()).unlocked, false);
  assert.equal((await session.unlock(proof)).unlocked, true);
  await assert.rejects(session.unlock({ methodId: crypto.randomUUID(), secret: proof.secret }), code('AUTHENTICATION'));
  await assert.rejects(session.unlock({ methodId: proof.methodId, prf: new Uint8Array(32) }), code('AUTHENTICATION'));
  assert.equal((await session.status()).unlocked, false);
});

Then('vault sessions edit credentials and approve or revoke exact destinations without returning secret values', kdfStep, async () => {
  const { session, storage, proof } = await created();
  let list = await session.put(proof, { label: 'Private account', kind: 'bearer', value: 'SYNTHETIC-PRIVATE-TOKEN' });
  const id = list[0].id, approval = await descriptor();
  assert.equal(list[0].label, 'Private account');
  assert.ok(!Object.hasOwn(list[0], 'value'));
  assert.ok(!JSON.stringify(storage.state).includes('Private account'));
  assert.ok(!JSON.stringify(storage.state).includes('SYNTHETIC-PRIVATE-TOKEN'));
  list = await session.grant(proof, id, 'service', approval);
  assert.equal(list[0].grants.length, 1);
  const oldGrant = list[0].grants[0].id;
  list = await session.grant(proof, id, 'service', approval);
  assert.equal(list[0].grants.length, 1);
  assert.notEqual(list[0].grants[0].id, oldGrant);
  await assert.rejects(session.grant(proof, id, 'service', { ...approval, fingerprint: 'wrong' }), code('PERMISSION'));
  await assert.rejects(session.grant(proof, id, 'missing', approval), code('PERMISSION'));
  await assert.rejects(session.grant(proof, crypto.randomUUID(), 'service', approval), code('PERMISSION'));
  list = await session.put(proof, { id, label: 'Renamed', kind: 'bearer', value: 'REPLACED-PRIVATE-TOKEN' });
  assert.equal(list[0].grants.length, 1);
  list = await session.revoke(proof, id, list[0].grants[0].id);
  assert.equal(list[0].grants.length, 0);
  await assert.rejects(session.revoke(proof, id, oldGrant), code('INVALID'));
  await assert.rejects(session.revoke(proof, crypto.randomUUID(), oldGrant), code('INVALID'));
  await session.grant(proof, id, 'service', approval);
  list = await session.put(proof, { id, label: 'Different credential type', kind: 'apiKey', value: 'API-KEY' });
  assert.equal(list[0].grants.length, 0);
  await assert.rejects(session.grant(proof, id, 'service', approval), code('PERMISSION'));
  await assert.rejects(session.put(proof, { id: crypto.randomUUID(), label: 'Missing', kind: 'bearer', value: 'VALUE' }), code('INVALID'));
  await assert.rejects(session.remove(proof, crypto.randomUUID()), code('INVALID'));
  assert.deepEqual(await session.remove(proof, id), []);
});

Then('vault sessions reject invalid credential input and malformed authenticated plaintext', kdfStep, async () => {
  const fixture = await populated();
  const { session, proof, storage } = fixture;
  for (const patch of [{ label: '' }, { label: ' '.repeat(5) }, { label: 'a'.repeat(121) }, { kind: 'basic' },
    { value: '' }, { value: 'has space' }, { value: '\r\nHeader: injection' }, { value: 'é' }, { value: 'a'.repeat(vaultLimits.secretBytes + 1) }]) {
    await assert.rejects(session.put(proof, { label: 'Private', kind: 'bearer', value: 'VALUE', ...patch }), code('INVALID'));
  }
  const good = clone(storage.state.snapshot);
  const mutations = [value => { value.extra = 'private leaked field'; }, value => { value.grants[0].extra = true; },
    value => { value.grants[0].descriptor.extra = true; }, value => { value.grants[0].id = 'bad'; },
    value => { value.grants.push(clone(value.grants[0])); }, value => { value.grants[0].scheme = ''; },
    value => { value.grants[0].descriptor.fingerprint = 'bad'; }, value => { value.grants[0].descriptor.origin = 42; },
    value => { value.grants = Array(257).fill(value.grants[0]); }, value => { value.grants = null; }];
  for (const mutate of mutations) {
    storage.state.snapshot = good;
    storage.state.snapshot = await tamperedRecord(fixture, mutate);
    await session.unlock(proof);
    await assert.rejects(session.list(), code('INVALID'));
  }
  storage.state.snapshot = good;
  storage.state.snapshot = await tamperedRecord(fixture, value => { value.id = crypto.randomUUID(); });
  await session.unlock(proof);
  await assert.rejects(session.list(), code('AUTHENTICATION'));
});

Then('vault restore authenticates both vaults and clears imported grants before committing', kdfStep, async () => {
  const source = await populated(), backup = await source.session.backup(source.proof), destination = await created();
  assert.ok(!backup.includes('SYNTHETIC-PRIVATE-TOKEN'));
  assert.ok(!backup.includes('Private account'));
  await assert.rejects(destination.session.restore(backup, source.proof), code('AUTHENTICATION'));
  await assert.rejects(destination.session.restore(backup, source.proof, { ...destination.proof, secret: randomBase64(32) }), code('AUTHENTICATION'));
  const status = await destination.session.restore(backup, source.proof, destination.proof);
  assert.equal(status.unlocked, true);
  const list = await destination.session.list();
  assert.equal(list[0].id, source.id);
  assert.equal(list[0].grants.length, 0);
  assert.equal(Object.hasOwn(list[0], 'value'), false);
  destination.session.lock();
  assert.equal((await destination.session.unlock(source.passwordProof)).unlocked, true);
  assert.equal((await destination.session.unlock(source.proof)).unlocked, true);
  const empty = new VaultSession(new MemoryStorage());
  assert.equal((await empty.restore(backup, source.proof)).exists, true);
  assert.equal((await empty.list())[0].grants.length, 0);
});

Then('a full vault rejects an additional credential before changing durable storage', kdfStep, async () => {
  const fixture = await created(), { storage, session, proof } = fixture;
  const snapshot = storage.state.snapshot, key = await rawKey(snapshot, proof);
  const records = await Promise.all(Array.from({ length: vaultLimits.records }, async (_, index) => {
    const id = crypto.randomUUID(), record = { id, kind: 'credential', revision: 1 };
    return { ...record, ciphertext: await encryptJSON(key, { id, label: `Account ${index}`, kind: 'bearer', value: 'TOKEN', grants: [] },
      { vaultId: snapshot.id, epoch: snapshot.epoch, ...record }) };
  }));
  storage.state.snapshot = await sealSnapshot({ id: snapshot.id, epoch: snapshot.epoch, revision: snapshot.revision,
    envelopes: snapshot.envelopes, records }, key);
  await session.unlock(proof);
  assert.equal((await session.list()).length, vaultLimits.records);
  const writes = storage.writes;
  await assert.rejects(session.put(proof, { label: 'Too many', kind: 'bearer', value: 'TOKEN' }), code('LIMIT'));
  assert.equal(storage.writes, writes);
});

Then('corrupt and unauthenticated vault backups never replace the current encrypted storage', kdfStep, async () => {
  const source = await populated(), backup = await source.session.backup(source.proof), destination = await created();
  const previous = clone(destination.storage.state), writes = destination.storage.writes;
  for (const invalid of ['', '{invalid json', '{}', JSON.stringify({ ...JSON.parse(backup), version: 2 })]) {
    await assert.rejects(destination.session.restore(invalid, source.proof, destination.proof), code('INVALID'));
  }
  for (const invalid of [null, 'a'.repeat(vaultLimits.backupBytes + 1)]) {
    await assert.rejects(destination.session.restore(invalid, source.proof, destination.proof), code('LIMIT'));
  }
  await assert.rejects(destination.session.restore(backup, { ...source.proof, secret: randomBase64(32) }, destination.proof), code('AUTHENTICATION'));
  const broken = JSON.parse(backup); broken.records[0].revision++;
  await assert.rejects(destination.session.restore(JSON.stringify(broken), source.proof, destination.proof), code('AUTHENTICATION'));
  const mismatched = await tamperedRecord(source, value => { value.id = crypto.randomUUID(); });
  await assert.rejects(destination.session.restore(JSON.stringify(mismatched), source.proof, destination.proof), code('AUTHENTICATION'));
  assert.equal(destination.storage.writes, writes);
  assert.deepEqual(destination.storage.state, previous);
});

Then('vault sessions confirm recovery changes and independently enroll replace and remove methods', kdfStep, async () => {
  const { session, proof, passwordProof } = await created();
  const prf = new Uint8Array(32).fill(7), material = { kind: 'passkey', prf, credentialId: randomBase64(48), prfSalt: randomBase64(32) };
  let status = await session.addMethod(proof, material);
  const passkey = status.methods.find(method => method.kind === 'passkey'), passkeyProof = { methodId: passkey.id, prf };
  assert.equal(passkey.credentialId, material.credentialId); assert.equal(passkey.prfSalt, material.prfSalt);
  assert.equal((await session.unlock(passkeyProof)).unlocked, true);
  await assert.rejects(session.unlock({ methodId: passkey.id, secret: 'not a PRF' }), code('AUTHENTICATION'));
  await session.unlock(proof);
  await assert.rejects(session.addMethod(proof, { kind: 'recovery', secret: randomBase64(32) }), code('AUTHENTICATION'));
  const recovery = await session.prepareRecovery(proof);
  await assert.rejects(session.addMethod(proof, { kind: 'recovery', secret: randomBase64(32) }), code('AUTHENTICATION'));
  status = await session.addMethod(proof, { kind: 'recovery', secret: recovery }, proof.methodId);
  const nextProof = { methodId: status.methods.find(method => method.kind === 'recovery').id, secret: recovery };
  await assert.rejects(session.unlock(proof), code('AUTHENTICATION'));
  await session.unlock(nextProof);
  await assert.rejects(session.addMethod(nextProof, material, passwordProof.methodId), code('INVALID'));
  status = await session.addMethod(nextProof, { kind: 'password', secret: 'replacement synthetic password' }, passwordProof.methodId);
  const nextPassword = { methodId: status.methods.find(method => method.kind === 'password').id, secret: 'replacement synthetic password' };
  await assert.rejects(session.unlock(passwordProof), code('AUTHENTICATION'));
  await session.unlock(nextPassword);
  await assert.rejects(session.removeMethod(nextPassword, nextPassword.methodId), code('INVALID'));
  await assert.rejects(session.removeMethod(nextPassword, crypto.randomUUID()), code('INVALID'));
  await session.removeMethod(nextPassword, passkeyProof.methodId);
  await assert.rejects(session.unlock(passkeyProof), code('AUTHENTICATION'));
  await session.unlock(nextPassword);
  status = await session.removeMethod(nextPassword, nextProof.methodId);
  assert.equal(status.methods.length, 1);
  await assert.rejects(session.removeMethod(nextPassword, nextPassword.methodId), code('INVALID'));
});

Then('vault rotation changes the key epoch while every retained method and complete old backup remain independently usable', kdfStep, async () => {
  const fixture = await populated(), { session, storage, proof, passwordProof } = fixture;
  const proofs = await retainedProofs(fixture), passkeyProof = proofs[2], prf = passkeyProof.prf;
  const backup = await session.backup(proof), previous = clone(storage.state.snapshot), writes = storage.writes;
  for (const invalid of [[proof], [proof, proof, passkeyProof], [proof, passwordProof, { methodId: crypto.randomUUID(), prf }],
    [proof, passwordProof, { ...passkeyProof, prf: new Uint8Array(32) }]]) {
    await assert.rejects(session.rotate(invalid), code('AUTHENTICATION'));
    assert.equal(storage.writes, writes);
  }
  assert.equal((await session.rotate(proofs)).unlocked, true);
  const current = storage.state.snapshot;
  assert.equal(current.epoch, previous.epoch + 1);
  assert.notEqual(current.records[0].ciphertext.data, previous.records[0].ciphertext.data);
  assert.notEqual(current.envelopes[0].wrappedKey.data, previous.envelopes[0].wrappedKey.data);
  const oldKey = await rawKey(previous, proof), currentRecord = current.records[0];
  await assert.rejects(decryptJSON(oldKey, currentRecord.ciphertext, { vaultId: current.id, epoch: current.epoch,
    kind: 'credential', id: currentRecord.id, revision: currentRecord.revision }), code('AUTHENTICATION'));
  for (const retained of proofs) {
    session.lock();
    assert.equal((await session.unlock(retained)).unlocked, true);
    assert.equal((await session.list())[0].id, fixture.id);
  }
  const historical = new VaultSession(new MemoryStorage());
  await historical.restore(backup, proof);
  assert.equal((await historical.list())[0].id, fixture.id);
});

Then('a rotated vault backup restores into fresh storage with every retained unlock method', kdfStep, async () => {
  const fixture = await populated(), proofs = await retainedProofs(fixture);
  await fixture.session.rotate(proofs);
  const backup = await fixture.session.backup(fixture.proof), rotated = clone(fixture.storage.state);
  const expected = (await fixture.session.list()).map(credential => ({ ...credential, grants: [] }));
  fixture.session.lock();
  for (const proof of proofs) {
    const storage = new MemoryStorage(), restored = new VaultSession(storage);
    const status = await restored.restore(backup, proof);
    assert.equal(status.unlocked, true);
    assert.equal(storage.state.snapshot.epoch, rotated.snapshot.epoch);
    assert.deepEqual(status.methods.map(method => method.id), rotated.snapshot.envelopes.map(envelope => envelope.id));
    assert.deepEqual(await restored.list(), expected);
    assert.equal(storage.writes, 1);
    assert.equal(storage.state.snapshot.revision, rotated.snapshot.revision + 1);
    restored.lock();
    const restarted = new VaultSession(storage);
    assert.equal((await restarted.unlock(proof)).unlocked, true);
    assert.deepEqual(await restarted.list(), expected);
    restarted.lock();
  }
  assert.deepEqual(fixture.storage.state, rotated);
});

Then('rotation interrupted {string} the atomic commit restarts with one complete authenticated snapshot', kdfStep, async phase => {
  assert.ok(['before', 'after'].includes(phase));
  const fixture = await populated(), proofs = await retainedProofs(fixture);
  const { session, storage } = fixture, previous = clone(storage.state), writes = storage.writes;
  const expected = await session.list(), reached = deferred(), release = deferred();
  const originalEncrypt = crypto.subtle.encrypt, originalReplace = storage.replace;
  if (phase === 'before') {
    // Pause the new manifest's encryption before save can authenticate and commit it.
    crypto.subtle.encrypt = async function (...args) {
      const encrypted = await originalEncrypt.apply(this, args);
      const context = JSON.parse(new TextDecoder().decode(args[0].additionalData));
      if (context.kind === 'manifest' && context.epoch === previous.snapshot.epoch + 1) {
        reached.resolve(); await release.promise;
      }
      return encrypted;
    };
  } else {
    // The atomic write is durable, but a terminated owner never receives its acknowledgement.
    storage.replace = async function (...args) {
      const committed = await originalReplace.apply(this, args);
      reached.resolve(); await release.promise;
      return committed;
    };
  }
  try {
    const rotation = session.rotate(proofs);
    await Promise.race([reached.promise, rotation]);
    session.lock(); release.resolve();
    await assert.rejects(rotation, code('CANCELLED'));
  } finally {
    crypto.subtle.encrypt = originalEncrypt;
    storage.replace = originalReplace;
    release.resolve();
  }
  assert.equal((await session.status()).unlocked, false);
  if (phase === 'before') {
    assert.deepEqual(storage.state, previous);
    assert.equal(storage.writes, writes);
  } else {
    assert.equal(storage.writes, writes + 1);
    assert.equal(storage.state.revision, previous.revision + 1);
    assert.equal(storage.state.lockEpoch, previous.lockEpoch + 1);
    assert.equal(storage.state.snapshot.epoch, previous.snapshot.epoch + 1);
    assert.equal(storage.state.snapshot.revision, previous.snapshot.revision + 1);
    assert.notDeepEqual(storage.state.snapshot.manifest, previous.snapshot.manifest);
  }
  for (const proof of proofs) {
    const restartedStorage = new MemoryStorage();
    restartedStorage.state = clone(storage.state);
    const restarted = new VaultSession(restartedStorage);
    const status = await restarted.unlock(proof);
    assert.equal(status.unlocked, true);
    assert.equal(restartedStorage.state.snapshot.epoch, previous.snapshot.epoch + (phase === 'after' ? 1 : 0));
    assert.deepEqual(await restarted.list(), expected);
    assert.equal(restartedStorage.writes, 0);
    restarted.lock();
  }
});

Then('vault sessions detect both durable revisions and lock epochs before using credentials', kdfStep, async () => {
  const { storage, session, proof } = await created(), other = new VaultSession(storage);
  await other.unlock(proof);
  await other.put(proof, { label: 'Other tab', kind: 'apiKey', value: 'OTHER-TOKEN' });
  await assert.rejects(session.list(), code('CONFLICT'));
  assert.equal((await session.status()).unlocked, false);
  await session.unlock(proof);
  storage.state.lockEpoch++;
  await assert.rejects(session.assertCurrent(), code('CONFLICT'));
  await session.unlock(proof);
  await storage.lock();
  assert.equal((await session.status()).unlocked, false);
  await session.unlock(proof);
  const writes = storage.writes;
  storage.replaceHook = () => storage.lock();
  await assert.rejects(session.put(proof, { label: 'Racing mutation', kind: 'bearer', value: 'VALUE' }), code('CONFLICT'));
  assert.equal(storage.writes, writes);
  assert.equal((await session.status()).unlocked, false);
});

Then('vault sessions discard pending creation authentication and decrypted results when locked', kdfStep, async () => {
  const storage = new MemoryStorage(), session = new VaultSession(storage), pause = deferred();
  storage.readHook = () => pause.promise;
  const pendingCreate = session.prepareCreate(password);
  session.lock(); pause.resolve();
  await assert.rejects(pendingCreate, code('CANCELLED'));
  assert.equal(storage.writes, 0);
  await assert.rejects(session.confirmCreate('stale'), code('AUTHENTICATION'));
  const recovery = await session.prepareCreate(password);
  session.lock();
  await assert.rejects(session.confirmCreate(recovery), code('AUTHENTICATION'));
  const fixture = await populated(), paused = deferred();
  fixture.session.lock(); fixture.storage.readHook = () => paused.promise;
  const unlock = fixture.session.unlock(fixture.proof);
  fixture.session.lock(); paused.resolve();
  await assert.rejects(unlock, code('CANCELLED'));
  assert.equal((await fixture.session.status()).unlocked, false);
  await fixture.session.unlock(fixture.proof);
  const listing = deferred(); fixture.storage.readHook = () => listing.promise;
  const list = fixture.session.list(); fixture.session.lock(); listing.resolve();
  await assert.rejects(list, code('CANCELLED'));
  assert.equal((await fixture.session.status()).unlocked, false);
  await fixture.session.unlock(fixture.proof);
  const decrypted = deferred(), release = deferred(), originalDecrypt = crypto.subtle.decrypt;
  crypto.subtle.decrypt = async function (...args) {
    const plaintext = await originalDecrypt.apply(this, args);
    decrypted.resolve(); await release.promise;
    return plaintext;
  };
  try {
    const pendingList = fixture.session.list();
    await decrypted.promise;
    fixture.session.lock(); release.resolve();
    await assert.rejects(pendingList, code('CANCELLED'));
  } finally { crypto.subtle.decrypt = originalDecrypt; release.resolve(); }
});

Then('vault sessions check the active deadline before access and after authentication completes', kdfStep, async () => {
  let active = true;
  const fixture = await created(() => { if (!active) throw new VaultError('LOCKED'); });
  active = false;
  await assert.rejects(fixture.session.list(), code('LOCKED'));
  active = true;
  fixture.session.lock();
  let reads = 0;
  const original = fixture.storage.read.bind(fixture.storage);
  fixture.storage.read = async () => {
    const state = await original(); reads++;
    if (reads === 3) active = false;
    return state;
  };
  await assert.rejects(fixture.session.unlock(fixture.proof), code('LOCKED'));
  active = true;
  assert.equal((await fixture.session.status()).unlocked, false);
  assert.equal((await fixture.session.unlock(fixture.proof)).unlocked, true);
  reads = 0;
  fixture.storage.read = async () => {
    reads++;
    if (reads === 2) throw new VaultError('UNAVAILABLE');
    return original();
  };
  await assert.rejects(fixture.session.unlock(fixture.proof), code('UNAVAILABLE'));
  assert.equal((await fixture.session.status()).unlocked, false);
  const storage = new MemoryStorage(), session = new VaultSession(storage, () => { if (!active) throw new VaultError('LOCKED'); });
  const recovery = await session.prepareCreate(password);
  active = false;
  await assert.rejects(session.confirmCreate(recovery), code('LOCKED'));
  assert.equal(storage.writes, 0);
});

Then('vault session execution injects only an approved credential and returns sanitized results', kdfStep, async () => {
  const { session, approval, id } = await populated(), original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ echoed: 'SYNTHETIC-PRIVATE-TOKEN', ok: true }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const binding = { alternative: 0, fingerprint: approval.fingerprint, credentials: { service: id } };
    const result = await session.execute(approval, {}, binding);
    assert.equal(requests[0].options.headers.get('Authorization'), 'Bearer SYNTHETIC-PRIVATE-TOKEN');
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PRIVATE-TOKEN'));
    assert.equal(result.response.redacted, true);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(session.execute(approval, {}, binding, controller.signal), code('CANCELLED'));
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = original; }
});

Then('vault sessions reject stale schemas before approval and dispatch and before accepting a response', kdfStep, async () => {
  let current = false;
  const checked = [];
  const fixture = await created(undefined, async descriptor => {
    checked.push(descriptor);
    if (!current) throw new VaultError('PERMISSION');
  });
  const { session, storage, proof } = fixture;
  const id = (await session.put(proof, { label: 'Schema guarded account', kind: 'bearer', value: 'SCHEMA-GUARDED-TOKEN' }))[0].id;
  const approval = await descriptor(), writes = storage.writes;
  await assert.rejects(session.grant(proof, id, 'service', approval), code('PERMISSION'));
  assert.equal(storage.writes, writes);
  assert.equal((await session.list())[0].grants.length, 0);
  assert.deepEqual(checked, [approval]);
  current = true;
  await session.grant(proof, id, 'service', approval);
  const binding = { alternative: 0, fingerprint: approval.fingerprint, credentials: { service: id } };
  const original = globalThis.fetch;
  let requests = 0, changeDuringRequest = false;
  globalThis.fetch = async () => {
    requests++;
    if (changeDuringRequest) current = false;
    return Response.json({ accepted: true });
  };
  try {
    current = false;
    const beforeDenied = checked.length;
    await assert.rejects(session.execute(approval, {}, binding), code('PERMISSION'));
    assert.equal(checked.length, beforeDenied + 1);
    assert.equal(requests, 0);
    current = true;
    const beforeAccepted = checked.length;
    assert.deepEqual((await session.execute(approval, {}, binding)).response.body, { accepted: true });
    assert.equal(checked.length, beforeAccepted + 2, 'check immediately before dispatch and before releasing the result');
    assert.equal(requests, 1);
    changeDuringRequest = true;
    const beforeChanged = checked.length;
    await assert.rejects(session.execute(approval, {}, binding), code('PERMISSION'));
    assert.equal(checked.length, beforeChanged + 2);
    assert.equal(requests, 2, 'a request already dispatched is not retried after the schema changes');
    assert.ok(checked.every(value => value.fingerprint === approval.fingerprint));
  } finally { globalThis.fetch = original; }
});
