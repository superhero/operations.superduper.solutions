// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { canonicalJSON, decodeBase64, decryptJSON, digest, encodeBase64, encryptJSON, newVaultKey,
  passkeyKey, passwordKey, randomBase64, recoveryKey, runtimeKey, unwrapVaultKey, wrapVaultKey } from './lib/secrets/crypto.ts';
import { authenticateManifest, sealSnapshot, validateSnapshot } from './lib/secrets/format.ts';
import { passwordProfile, VaultError, vaultLimits } from './lib/secrets/types.ts';

const code = expected => error => error instanceof VaultError && error.code === expected
  && !Object.hasOwn(error, 'cause');
const context = (kind = 'credential') => ({ vaultId: crypto.randomUUID(), id: crypto.randomUUID(), kind, epoch: 1, revision: 1 });
const clone = value => structuredClone(value);
function changedBase64(value) {
  const bytes = decodeBase64(value);
  bytes[0] ^= 1;
  return encodeBase64(bytes);
}
async function fixture() {
  const key = await newVaultKey(), kek = await newVaultKey(), id = crypto.randomUUID();
  const envelopeId = crypto.randomUUID(), recordId = crypto.randomUUID();
  const envelope = { id: envelopeId, kind: 'password', revision: 1, salt: randomBase64(16), profile: { ...passwordProfile },
    wrappedKey: await wrapVaultKey(key, kek, { vaultId: id, id: envelopeId, kind: 'password', epoch: 1, revision: 1 }) };
  const record = { id: recordId, kind: 'credential', revision: 1,
    ciphertext: await encryptJSON(key, { label: 'Private label', value: 'private credential', grants: [] },
      { vaultId: id, id: recordId, kind: 'credential', epoch: 1, revision: 1 }) };
  const body = { id, epoch: 1, revision: 1, envelopes: [envelope], records: [record] };
  return { key, kek, body, snapshot: await sealSnapshot(body, key) };
}

Then('vault creation and wrapping use temporary keys while unlocked runtime keys reject export', async () => {
  const temporary = await newVaultKey(), kek = await newVaultKey(), aad = context('password');
  assert.equal(temporary.extractable, true);
  assert.equal((await crypto.subtle.exportKey('raw', temporary)).byteLength, 32);
  const runtime = await runtimeKey(temporary);
  assert.equal(runtime.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', runtime));
  const wrapped = await wrapVaultKey(temporary, kek, aad);
  assert.equal(decodeBase64(wrapped.data).byteLength, 48);
  const unlocked = await unwrapVaultKey(wrapped, kek, aad);
  assert.equal(unlocked.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', unlocked));
  const enrollment = await unwrapVaultKey(wrapped, kek, aad, true);
  assert.deepEqual(await crypto.subtle.exportKey('raw', enrollment), await crypto.subtle.exportKey('raw', temporary));
  const box = await encryptJSON(temporary, { value: 'only inside encryption' }, aad);
  assert.deepEqual(await decryptJSON(unlocked, box, aad), { value: 'only inside encryption' });
  await assert.rejects(wrapVaultKey(runtime, kek, aad), code('UNAVAILABLE'));
  await assert.rejects(runtimeKey(runtime), code('UNAVAILABLE'));
  const short = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt']);
  await assert.rejects(runtimeKey(short), code('INVALID'));
  await assert.rejects(wrapVaultKey(short, kek, aad), code('INVALID'));
  const malformed = await encryptJSON(kek, 'short', aad);
  await assert.rejects(unwrapVaultKey(malformed, kek, aad), code('AUTHENTICATION'));
});

Then('vault ciphertext rejects incorrect keys, tampering, and every changed context field', async () => {
  const key = await newVaultKey(), wrong = await newVaultKey(), aad = context();
  const value = { secret: 'private credential', label: 'private label', grants: [{ id: 'destination' }] };
  const first = await encryptJSON(key, value, aad), second = await encryptJSON(key, value, aad);
  assert.notEqual(first.iv, second.iv);
  assert.equal(decodeBase64(first.iv).byteLength, 12);
  assert.equal(decodeBase64(first.data).byteLength, new TextEncoder().encode(canonicalJSON(value)).length + 16);
  await assert.rejects(decryptJSON(wrong, first, aad), code('AUTHENTICATION'));
  for (const patch of [{ vaultId: crypto.randomUUID() }, { id: crypto.randomUUID() }, { epoch: 2 }, { revision: 2 }, { kind: 'recovery' }]) {
    await assert.rejects(decryptJSON(key, first, { ...aad, ...patch }), code('AUTHENTICATION'));
  }
  for (const field of ['data', 'iv']) await assert.rejects(decryptJSON(key, { ...first, [field]: changedBase64(first[field]) }, aad), code('AUTHENTICATION'));
  for (const patch of [{ vaultId: 'bad' }, { id: '' }, { epoch: 0 }, { revision: 1.5 }, { kind: 'unsupported' }, { version: 2 }]) {
    await assert.rejects(encryptJSON(key, value, { ...aad, ...patch }), code('INVALID'));
  }
});

Then('vault password derivation matches the independent Argon2id vector and preserves exact input', { timeout: 90_000 }, async () => {
  const salt = encodeBase64(Uint8Array.from({ length: 16 }, (_, index) => index));
  // Independently generated with libsodium 1.0.18 crypto_pwhash, ARGON2ID13,
  // opslimit=3, memlimit=67108864, password UTF-8 bytes for " password é ".
  const vector = Uint8Array.from(Buffer.from('6ec4d753a6eb44748641e284af56329734ff888a352d20552c46fb8fe32797e0', 'hex'));
  const reference = await crypto.subtle.importKey('raw', vector, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const actual = await passwordKey(' password é ', salt), aad = context('password');
  assert.equal(actual.extractable, false);
  const box = await encryptJSON(reference, { vector: 'matches' }, aad);
  assert.deepEqual(await decryptJSON(actual, box, aad), { vector: 'matches' });
  for (const password of ['password é', ' password e\u0301 ', 'wrong password']) {
    await assert.rejects(decryptJSON(await passwordKey(password, salt), box, aad), code('AUTHENTICATION'));
  }
  await assert.rejects(decryptJSON(await passwordKey(' password é ', randomBase64(16)), box, aad), code('AUTHENTICATION'));
});

Then('vault password derivation rejects unsupported profiles and invalid input before cryptographic work', async () => {
  const original = WebAssembly.instantiate;
  let initialized = 0;
  WebAssembly.instantiate = async () => { initialized++; throw new Error('must not initialize'); };
  try {
    for (const patch of [{ algorithm: 'argon2i' }, { version: 16 }, { memoryKiB: 2 ** 31 }, { iterations: 1 },
      { parallelism: 2 }, { outputBytes: 64 }, { attacker: true }]) {
      await assert.rejects(passwordKey('PRIVATE PASSWORD', randomBase64(16), { ...passwordProfile, ...patch }), code('INVALID'));
    }
    for (const password of ['', null, '\ud800', 'x'.repeat(vaultLimits.secretBytes + 1)]) {
      await assert.rejects(passwordKey(password, randomBase64(16)), code('INVALID'));
    }
    await assert.rejects(passwordKey('é'.repeat(vaultLimits.secretBytes), randomBase64(16)), code('LIMIT'));
    await assert.rejects(passwordKey('PRIVATE PASSWORD', randomBase64(15)), code('INVALID'));
    assert.equal(initialized, 0);
  } finally { WebAssembly.instantiate = original; }
});

Then('vault recovery and passkey wrapping keys are separated by HKDF purpose and salt', async () => {
  const material = decodeBase64(randomBase64(32)), recoverySecret = randomBase64(128), salt = randomBase64(16), aad = context('recovery');
  const recovery = await recoveryKey(recoverySecret, salt), passkey = await passkeyKey(material, salt);
  assert.equal(recovery.extractable, false);
  assert.equal(passkey.extractable, false);
  assert.ok(material.some(byte => byte !== 0), 'the caller owns the supplied PRF buffer');
  const box = await encryptJSON(recovery, { protected: true }, aad);
  assert.deepEqual(await decryptJSON(await recoveryKey(recoverySecret, salt), box, aad), { protected: true });
  await assert.rejects(decryptJSON(passkey, box, aad), code('AUTHENTICATION'));
  await assert.rejects(decryptJSON(await recoveryKey(recoverySecret, randomBase64(16)), box, aad), code('AUTHENTICATION'));
  for (const length of [31, 32, 127, 129]) await assert.rejects(recoveryKey(randomBase64(length), salt), code('INVALID'));
  await assert.rejects(passkeyKey(new Uint8Array(31), salt), code('INVALID'));
  await assert.rejects(passkeyKey(material, randomBase64(15)), code('INVALID'));
});

Then('vault snapshots reject unsupported versions, malformed fields, oversized records, and duplicate identities', async () => {
  const { snapshot } = await fixture();
  assert.deepEqual(validateSnapshot(snapshot), snapshot);
  const mutations = [
    value => { value.version = 2; }, value => { value.id = 'not a UUID'; },
    value => { value.epoch = 0; }, value => { value.revision = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.label = 'a private label'; }, value => { delete value.manifest; },
    value => { value.records[0].value = 'plaintext forbidden'; }, value => { value.records[0].kind = 'other'; },
    value => { value.records[0].revision = -1; }, value => { value.records[0].id = value.envelopes[0].id; },
    value => { value.records.push(clone(value.records[0])); }, value => { value.envelopes.push(clone(value.envelopes[0])); },
    value => { value.records = Array(1001).fill(value.records[0]); }, value => { value.envelopes = []; },
    value => { value.envelopes = Array(17).fill(value.envelopes[0]); }, value => { value.records = [undefined]; },
    value => { delete value.records[0]; }, value => { value.records.extra = true; },
    value => { value.manifest.iv = randomBase64(11); }, value => { value.manifest.data = randomBase64(15); },
    value => { value.manifest.extra = true; }, value => { value.envelopes[0].wrappedKey.data = randomBase64(47); },
  ];
  for (const mutate of mutations) {
    const invalid = clone(snapshot); mutate(invalid);
    assert.throws(() => validateSnapshot(invalid), code('INVALID'));
  }
  const oversized = clone(snapshot);
  oversized.records[0].ciphertext.data = 'A'.repeat(vaultLimits.recordBytes);
  assert.throws(() => validateSnapshot(oversized), code('LIMIT'));
  const oversizedManifest = clone(snapshot);
  oversizedManifest.manifest.data = 'A'.repeat(vaultLimits.recordBytes * 2);
  assert.throws(() => validateSnapshot(oversizedManifest), code('LIMIT'));
  let getterCalls = 0;
  const accessor = clone(snapshot);
  Object.defineProperty(accessor, 'version', { enumerable: true, get() { getterCalls++; return 1; } });
  assert.throws(() => validateSnapshot(accessor), code('INVALID'));
  assert.equal(getterCalls, 0);
  const arrayAccessor = clone(snapshot);
  Object.defineProperty(arrayAccessor.records, '0', { enumerable: true, get() { getterCalls++; return snapshot.records[0]; } });
  assert.throws(() => validateSnapshot(arrayAccessor), code('INVALID'));
  assert.equal(getterCalls, 0);
  const nonstring = clone(snapshot); nonstring.envelopes[0].salt = null;
  assert.throws(() => validateSnapshot(nonstring), code('INVALID'));
  assert.throws(() => validateSnapshot(Object.create(snapshot)), code('INVALID'));
  assert.throws(() => validateSnapshot(null), code('INVALID'));
  const symbol = clone(snapshot); symbol[Symbol('hidden')] = true;
  assert.throws(() => validateSnapshot(symbol), code('INVALID'));
  const sizeBounded = clone(snapshot);
  sizeBounded.records = Array.from({ length: 150 }, () => ({ ...clone(snapshot.records[0]), id: crypto.randomUUID(),
    ciphertext: { ...snapshot.records[0].ciphertext, data: 'A'.repeat(240000) } }));
  assert.throws(() => validateSnapshot(sizeBounded), code('LIMIT'));
});

Then('vault snapshots validate exact password, recovery, and passkey metadata', async () => {
  const { snapshot } = await fixture();
  const password = snapshot.envelopes[0];
  const recovery = { id: crypto.randomUUID(), kind: 'recovery', revision: 1, salt: randomBase64(16), wrappedKey: password.wrappedKey };
  const passkey = { ...recovery, id: crypto.randomUUID(), kind: 'passkey', credentialId: randomBase64(48), prfSalt: randomBase64(32) };
  const valid = { ...snapshot, envelopes: [password, recovery, passkey] };
  assert.deepEqual(validateSnapshot(valid), valid);
  assert.throws(() => validateSnapshot({ ...valid, envelopes: [...valid.envelopes, { ...recovery, id: crypto.randomUUID() }] }), code('INVALID'));
  for (const invalid of [{ ...password, profile: undefined }, { ...password, profile: { ...passwordProfile, memoryKiB: 1 } },
    { ...password, prfSalt: randomBase64(32) }, { ...recovery, profile: passwordProfile }, { ...recovery, kind: 'other' },
    { ...passkey, profile: passwordProfile }, { ...passkey, credentialId: '' }, { ...passkey, credentialId: 'A'.repeat(1372) },
    { ...passkey, prfSalt: randomBase64(31) }, { ...passkey, credentialId: 'url-safe_' }]) {
    assert.throws(() => validateSnapshot({ ...snapshot, envelopes: [invalid] }), code('INVALID'));
  }
});

Then('vault manifests reject selective rollback, omitted records, substituted envelopes, and revision relabeling', async () => {
  const { key, body, snapshot } = await fixture();
  const manifest = await authenticateManifest(snapshot, key);
  assert.equal(manifest.records[0].digest, await digest(snapshot.records[0]));
  assert.equal(manifest.envelopes[0].digest, await digest(snapshot.envelopes[0]));
  const record = { ...body.records[0], revision: 2, ciphertext: await encryptJSON(key, { value: 'new private credential' },
    { vaultId: body.id, id: body.records[0].id, kind: 'credential', epoch: 1, revision: 2 }) };
  const latest = await sealSnapshot({ ...body, revision: 2, records: [record] }, key);
  const mutations = [
    value => { value.records = []; }, value => { value.records[0] = snapshot.records[0]; },
    value => { value.records[0].ciphertext = snapshot.records[0].ciphertext; },
    value => { value.envelopes[0].wrappedKey.data = changedBase64(value.envelopes[0].wrappedKey.data); },
    value => { value.envelopes[0].salt = randomBase64(16); }, value => { value.records[0].revision++; },
    value => { value.envelopes[0].revision++; }, value => { value.revision++; },
    value => { value.epoch++; }, value => { value.id = crypto.randomUUID(); },
  ];
  for (const mutate of mutations) {
    const invalid = clone(latest); mutate(invalid);
    await assert.rejects(authenticateManifest(invalid, key), code('AUTHENTICATION'));
  }
  await assert.rejects(authenticateManifest(latest, await newVaultKey()), code('AUTHENTICATION'));
  const malformed = { ...latest, manifest: await encryptJSON(key, { ...manifest, hidden: true },
    { vaultId: latest.id, id: latest.id, kind: 'manifest', epoch: latest.epoch, revision: latest.revision }) };
  await assert.rejects(authenticateManifest(malformed, key), code('AUTHENTICATION'));
  assert.ok(!JSON.stringify(latest).includes('private'), 'snapshot includes no private values or labels');
});

Then('complete authenticated older vault snapshots remain readable with their original key', async () => {
  const { key, body, snapshot } = await fixture();
  await sealSnapshot({ ...body, revision: 2 }, key);
  assert.equal((await authenticateManifest(snapshot, key)).revision, 1);
});

Then('vault encoding rejects ambiguous base64 and unsafe JSON without exposing input diagnostics', async () => {
  for (const length of [0, 1, 2, 3, 8193]) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
    assert.deepEqual(decodeBase64(encodeBase64(bytes), length), bytes);
  }
  for (const value of ['YQ', 'YQ= ', 'YR==', '====', 'a===', 'é===', null, 'A'.repeat(4 * Math.ceil(vaultLimits.backupBytes / 3) + 4)]) {
    assert.throws(() => decodeBase64(value), code('INVALID'));
  }
  assert.throws(() => decodeBase64('YQ==', 2), code('INVALID'));
  assert.throws(() => decodeBase64('', -1), code('INVALID'));
  for (const length of [0, 65537, 1.5]) assert.throws(() => randomBase64(length), code('INVALID'));
  assert.equal(await digest({ z: [true, null], a: 1 }), await digest({ a: 1, z: [true, null] }));
  assert.notEqual(await digest({ a: 1 }), await digest({ a: 2 }));
  const circular = {}; circular.self = circular;
  for (const value of [undefined, NaN, 1n, circular, new Date(), [,], { a: undefined }]) {
    assert.throws(() => canonicalJSON(value), code('INVALID'));
  }
  let deep = {}; for (let index = 0; index < 70; index++) deep = { nested: deep };
  assert.throws(() => canonicalJSON(deep), code('INVALID'));
  assert.throws(() => canonicalJSON('PRIVATE INPUT', 4), code('LIMIT'));
  assert.throws(() => canonicalJSON([0, 0], 1), code('LIMIT'));
  const arrayAccessor = [0];
  Object.defineProperty(arrayAccessor, '0', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => canonicalJSON(arrayAccessor), code('INVALID'));
  const key = await newVaultKey(), aad = context(), iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(canonicalJSON({ version: 1, ...aad }));
  const invalidJSON = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key,
    new TextEncoder().encode('PRIVATE INVALID JSON'));
  await assert.rejects(decryptJSON(key, { iv: encodeBase64(iv), data: encodeBase64(new Uint8Array(invalidJSON)) }, aad), code('AUTHENTICATION'));
  await assert.rejects(decryptJSON(key, { iv: encodeBase64(iv), data: 'AAAA' }, aad), code('INVALID'));
  await assert.rejects(decryptJSON(key, { iv: encodeBase64(iv), data: 'A'.repeat(vaultLimits.recordBytes * 2) }, aad), code('INVALID'));
  await assert.rejects(decryptJSON(key, { iv: encodeBase64(iv), data: null }, aad), code('INVALID'));
});

Then('vault cryptographic provider failures return safe unavailable errors', { timeout: 90_000 }, async () => {
  const key = await newVaultKey(), aad = context(), original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    assert.throws(() => randomBase64(16), code('UNAVAILABLE'));
    await assert.rejects(newVaultKey(), code('UNAVAILABLE'));
    await assert.rejects(encryptJSON(key, { value: 'private' }, aad), code('UNAVAILABLE'));
    await assert.rejects(digest({ value: 'private' }), code('UNAVAILABLE'));
    await assert.rejects(recoveryKey(encodeBase64(new Uint8Array(128)), encodeBase64(new Uint8Array(16))), code('UNAVAILABLE'));
    await assert.rejects(passwordKey('valid synthetic password', encodeBase64(new Uint8Array(16))), code('UNAVAILABLE'));
  } finally { Object.defineProperty(globalThis, 'crypto', original); }
});
