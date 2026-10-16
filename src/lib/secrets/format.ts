// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { canonicalJSON, decodeBase64, decryptJSON, digest, encryptJSON, ownObject, validId,
  validRevision, validatePasswordProfile } from "./crypto.ts";
import { VaultError, vaultLimits } from "./types.ts";
import type { Ciphertext, CryptoContext, EncryptedRecord, KeyEnvelope, VaultManifest, VaultSnapshot } from "./types.ts";

const maxEnvelopes = 16;
type SnapshotContents = Pick<VaultSnapshot, "id" | "epoch" | "revision" | "envelopes" | "records">;

function id(value: unknown): string {
  if (!validId(value)) throw new VaultError("INVALID");
  return value;
}
function revision(value: unknown): number {
  if (!validRevision(value)) throw new VaultError("INVALID");
  return value;
}
function base64(value: unknown, length?: number): string {
  if (typeof value !== "string") throw new VaultError("INVALID");
  decodeBase64(value, length).fill(0);
  return value;
}
function ciphertext(value: unknown, wrapped = false): Ciphertext {
  const object = ownObject(value, ["iv", "data"]);
  const iv = base64(object.iv, 12);
  // Check length before decoding, so attacker-controlled fields cannot allocate large buffers.
  if (typeof object.data !== "string" || object.data.length > Math.ceil((vaultLimits.recordBytes + 16) / 3) * 4) {
    throw new VaultError("LIMIT");
  }
  const bytes = decodeBase64(object.data, wrapped ? 48 : undefined);
  const length = bytes.byteLength;
  bytes.fill(0);
  if (length < 16 || length > vaultLimits.recordBytes + 16) throw new VaultError("INVALID");
  return { iv, data: object.data };
}
function array(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new VaultError("INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new VaultError("INVALID");
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new VaultError("INVALID");
    return descriptor.value;
  });
}
function envelope(value: unknown): KeyEnvelope {
  const object = ownObject(value, ["id", "kind", "revision", "salt", "wrappedKey"], ["profile", "credentialId", "prfSalt"]);
  if (object.kind !== "password" && object.kind !== "recovery" && object.kind !== "passkey") throw new VaultError("INVALID");
  const result: KeyEnvelope = { id: id(object.id), kind: object.kind, revision: revision(object.revision),
    salt: base64(object.salt, 16), wrappedKey: ciphertext(object.wrappedKey, true) };
  if (object.kind === "password") {
    if (Object.hasOwn(object, "credentialId") || Object.hasOwn(object, "prfSalt")) throw new VaultError("INVALID");
    result.profile = validatePasswordProfile(object.profile);
  } else if (object.kind === "passkey") {
    if (Object.hasOwn(object, "profile") || typeof object.credentialId !== "string"
      || object.credentialId.length < 4 || object.credentialId.length > 1368) throw new VaultError("INVALID");
    result.credentialId = base64(object.credentialId);
    result.prfSalt = base64(object.prfSalt, 32);
  } else if (["profile", "credentialId", "prfSalt"].some(name => Object.hasOwn(object, name))) {
    throw new VaultError("INVALID");
  }
  return result;
}
function record(value: unknown): EncryptedRecord {
  const object = ownObject(value, ["id", "kind", "revision", "ciphertext"]);
  if (object.kind !== "credential") throw new VaultError("INVALID");
  canonicalJSON(object, vaultLimits.recordBytes);
  return { id: id(object.id), kind: "credential", revision: revision(object.revision), ciphertext: ciphertext(object.ciphertext) };
}
function contents(value: unknown): SnapshotContents {
  const object = ownObject(value, ["id", "epoch", "revision", "envelopes", "records"]);
  const envelopes = array(object.envelopes, maxEnvelopes, 1).map(envelope);
  if (envelopes.filter(item => item.kind === "recovery").length > 1) throw new VaultError("INVALID");
  const records = array(object.records, vaultLimits.records).map(record);
  const ids = [...envelopes.map(item => item.id), ...records.map(item => item.id)];
  if (new Set(ids).size !== ids.length) throw new VaultError("INVALID");
  return { id: id(object.id), epoch: revision(object.epoch), revision: revision(object.revision), envelopes, records };
}

/** Parse only bounded, own JSON fields; labels, grants and credentials have no public fields. */
export function validateSnapshot(value: unknown): VaultSnapshot {
  const object = ownObject(value, ["version", "id", "epoch", "revision", "envelopes", "manifest", "records"]);
  if (object.version !== 1) throw new VaultError("INVALID");
  const { version: _version, manifest, ...body } = object;
  const result: VaultSnapshot = { version: 1, ...contents(body), manifest: ciphertext(manifest) };
  canonicalJSON(result, vaultLimits.backupBytes);
  return result;
}

function manifestContext(snapshot: SnapshotContents): CryptoContext {
  return { vaultId: snapshot.id, epoch: snapshot.epoch, kind: "manifest", id: snapshot.id, revision: snapshot.revision };
}
async function inventory(snapshot: SnapshotContents): Promise<VaultManifest> {
  return { version: 1, vaultId: snapshot.id, epoch: snapshot.epoch, revision: snapshot.revision,
    envelopes: await Promise.all(snapshot.envelopes.map(async envelope => ({ id: envelope.id, digest: await digest(envelope) }))),
    records: await Promise.all(snapshot.records.map(async record => ({ id: record.id, revision: record.revision, digest: await digest(record) }))) };
}

/** A valid complete older snapshot remains valid: local storage cannot establish external freshness. */
export async function authenticateManifest(value: VaultSnapshot, key: CryptoKey): Promise<VaultManifest> {
  const snapshot = validateSnapshot(value);
  try {
    const manifest = await decryptJSON(key, snapshot.manifest, manifestContext(snapshot));
    const expected = await inventory(snapshot);
    if (canonicalJSON(manifest, vaultLimits.recordBytes) !== canonicalJSON(expected, vaultLimits.recordBytes)) {
      throw new VaultError("AUTHENTICATION");
    }
    return expected;
  } catch { throw new VaultError("AUTHENTICATION"); }
}

export async function sealSnapshot(value: SnapshotContents, key: CryptoKey): Promise<VaultSnapshot> {
  const snapshot = contents(value);
  const manifest = await encryptJSON(key, await inventory(snapshot), manifestContext(snapshot));
  return validateSnapshot({ version: 1, ...snapshot, manifest });
}
