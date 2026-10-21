// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputValues } from "../operation-input.ts";
import { decryptJSON, encryptJSON, newVaultKey, passwordKey, recoveryKey, passkeyKey, randomBase64,
  runtimeKey, unwrapVaultKey, wrapVaultKey, validId, canonicalJSON, ownObject } from "./crypto.ts";
import { authenticateManifest, sealSnapshot, validateSnapshot } from "./format.ts";
import { approvedOperation } from "./policy.ts";
import { publicVaultKeys } from "./key-index.ts";
import { executeCredentialed } from "./execution.ts";
import { checkPrivateAssertion } from "./processing.ts";
import { VaultError, passwordProfile, vaultLimits, recoveryKeyBytes, recoveryKeyCharacters } from "./types.ts";
import type { ApprovedOperation, CredentialBinding, CredentialSummary, CryptoContext, Enrollment,
  KeyEnvelope, UnlockProof, VaultCredential, VaultSnapshot, VaultStatus, VaultKey } from "./types.ts";
import type { VaultState, VaultStorage } from "./storage.ts";

type Pending = { state: VaultState; snapshot: VaultSnapshot; key: CryptoKey; recovery: string };
const context = (snapshot: Pick<VaultSnapshot, "id" | "epoch">, item: { id: string; kind: string; revision: number }): CryptoContext =>
  ({ vaultId: snapshot.id, epoch: snapshot.epoch, kind: item.kind, id: item.id, revision: item.revision });

function credential(value: VaultCredential): VaultCredential {
  ownObject(value, ["id", "label", "kind", "value", "grants"]);
  if (!validId(value.id) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 120
    || !["bearer", "apiKey", "secret"].includes(value.kind) || typeof value.value !== "string" || !value.value
    || /[^\x21-\x7e]/.test(value.value) || value.value.length > vaultLimits.secretBytes
    || !Array.isArray(value.grants) || value.grants.length > 256) throw new VaultError("INVALID");
  canonicalJSON(value, vaultLimits.recordBytes);
  const grantIds = new Set<string>();
  for (const grant of value.grants) {
    ownObject(grant, ["id", "scheme", "descriptor"]);
    ownObject(grant.descriptor, ["fingerprint", "origin", "operation"]);
    if (!validId(grant.id) || grantIds.has(grant.id) || typeof grant.scheme !== "string" || !grant.scheme
      || typeof grant.descriptor.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(grant.descriptor.fingerprint)
      || typeof grant.descriptor.origin !== "string") throw new VaultError("INVALID");
    grantIds.add(grant.id);
  }
  return value;
}

async function wrappingKey(envelope: KeyEnvelope, proof: UnlockProof): Promise<CryptoKey> {
  if (envelope.kind === "passkey") {
    if (!("prf" in proof)) throw new VaultError("AUTHENTICATION");
    return passkeyKey(proof.prf, envelope.salt);
  }
  if (!("secret" in proof)) throw new VaultError("AUTHENTICATION");
  return envelope.kind === "password" ? passwordKey(proof.secret, envelope.salt, envelope.profile)
    : recoveryKey(proof.secret, envelope.salt);
}

/** The owning worker serializes commands. No method returns credential values or vault key material. */
export class VaultSession {
  private readonly storage: VaultStorage;
  private readonly assertActive: () => void;
  private readonly assertSchema: (descriptor: ApprovedOperation) => Promise<void>;
  private state: VaultState | undefined;
  private key: CryptoKey | undefined;
  private generation = 0;
  private pending: Pending | undefined;

  constructor(storage: VaultStorage, assertActive: () => void = () => {}, assertSchema: (descriptor: ApprovedOperation) => Promise<void> = async () => {}) {
    this.storage = storage; this.assertActive = assertActive; this.assertSchema = assertSchema;
  }

  lock(): void { this.generation++; this.key = undefined; this.state = undefined; this.pending = undefined; }

  private guard(generation: number): void {
    this.assertActive();
    if (generation !== this.generation) throw new VaultError("CANCELLED");
  }

  async status(): Promise<VaultStatus> {
    const state = await this.storage.read();
    const snapshot = state.snapshot ? validateSnapshot(state.snapshot) : null;
    const unlocked = !!this.key && state.revision === this.state?.revision && state.lockEpoch === this.state?.lockEpoch;
    if (this.key && !unlocked) this.lock();
    return { exists: !!snapshot, unlocked, revision: state.revision, epoch: state.lockEpoch,
      methods: snapshot?.envelopes.map(({ id, kind, credentialId, prfSalt }) =>
        ({ id, kind, ...(credentialId ? { credentialId } : {}), ...(prfSalt ? { prfSalt } : {}) })) ?? [] };
  }

  async assertCurrent(): Promise<void> {
    this.assertActive();
    if (!this.key || !this.state?.snapshot) throw new VaultError("LOCKED");
    const generation = this.generation;
    const state = await this.storage.read();
    this.guard(generation);
    if (state.revision !== this.state.revision || state.lockEpoch !== this.state.lockEpoch) {
      this.lock(); throw new VaultError("CONFLICT");
    }
  }

  private async authenticate(snapshot: VaultSnapshot, proof: UnlockProof, extractable = false): Promise<CryptoKey> {
    const automaticSecret = proof.methodId === "auto" && "secret" in proof ? proof.secret : undefined;
    const automatic = automaticSecret !== undefined;
    const candidates = automatic ? [
      ...snapshot.envelopes.filter(item => item.kind === "recovery" && automaticSecret?.length === recoveryKeyCharacters),
      ...snapshot.envelopes.filter(item => item.kind === "password"),
    ] : snapshot.envelopes.filter(item => item.id === proof.methodId);
    const generation = this.generation;
    for (const envelope of candidates) {
      this.guard(generation);
      try {
        const key = await unwrapVaultKey(envelope.wrappedKey, await wrappingKey(envelope, proof), context(snapshot, envelope), extractable);
        await authenticateManifest(snapshot, key);
        this.guard(generation);
        if (automatic) proof.methodId = envelope.id;
        return key;
      } catch (error) {
        if (!automatic || !(error instanceof VaultError) || !["AUTHENTICATION", "INVALID"].includes(error.code)) throw error;
      }
    }
    throw new VaultError("AUTHENTICATION");
  }

  async unlock(proof: UnlockProof): Promise<VaultStatus> {
    this.lock();
    const generation = this.generation;
    try {
      const state = await this.storage.read();
      if (!state.snapshot) throw new VaultError("LOCKED");
      const snapshot = validateSnapshot(state.snapshot);
      const key = await this.authenticate(snapshot, proof);
      this.guard(generation);
      this.key = key; this.state = { ...state, snapshot };
      await this.assertCurrent();
      if (state.keys === undefined)
        this.state = await this.storage.indexKeys(this.state, (await this.records()).map(({ id, label, kind }) => ({ id, label, kind })));
      this.guard(generation);
      const status = await this.status();
      this.guard(generation);
      return status;
    } catch (error) {
      this.lock();
      throw error;
    }
  }

  private async enroll(key: CryptoKey, snapshot: Pick<VaultSnapshot, "id" | "epoch">, material: Enrollment): Promise<KeyEnvelope> {
    const base = { id: crypto.randomUUID(), revision: 1, kind: material.kind, salt: randomBase64(16) };
    if (material.kind === "password" && material.secret.length < 3) throw new VaultError("INVALID");
    const kek = material.kind === "password" ? await passwordKey(material.secret, base.salt)
      : material.kind === "recovery" ? await recoveryKey(material.secret, base.salt) : await passkeyKey(material.prf, base.salt);
    const wrappedKey = await wrapVaultKey(key, kek, context(snapshot, base));
    const envelope: KeyEnvelope = { ...base, wrappedKey,
      ...(material.kind === "password" ? { profile: { ...passwordProfile } } : {}),
      ...(material.kind === "passkey" ? { credentialId: material.credentialId, prfSalt: material.prfSalt } : {}) };
    // Prove the new envelope unwraps before it can become durable.
    await unwrapVaultKey(wrappedKey, kek, context(snapshot, envelope));
    return envelope;
  }

  async prepareCreate(password: string): Promise<string> {
    this.lock(); const generation = this.generation;
    const state = await this.storage.read();
    if (state.snapshot) throw new VaultError("CONFLICT");
    const key = await newVaultKey();
    const recovery = randomBase64(recoveryKeyBytes);
    const base = { id: crypto.randomUUID(), epoch: 1, revision: 1, records: [] };
    const envelopes = [await this.enroll(key, base, { kind: "password", secret: password }),
      await this.enroll(key, base, { kind: "recovery", secret: recovery })];
    const snapshot = await sealSnapshot({ ...base, envelopes }, key);
    const runtime = await runtimeKey(key);
    this.guard(generation);
    this.pending = { state, snapshot, key: runtime, recovery };
    return recovery;
  }

  async confirmCreate(recovery: string): Promise<VaultStatus> {
    const pending = this.pending;
    if (!pending || recovery !== pending.recovery) throw new VaultError("AUTHENTICATION");
    const generation = this.generation;
    this.guard(generation);
    const state = await this.storage.replace(pending.state, pending.snapshot, []);
    this.guard(generation);
    this.pending = undefined; this.key = pending.key; this.state = state;
    return this.status();
  }

  private async fresh(proof: UnlockProof): Promise<CryptoKey> {
    await this.assertCurrent();
    const generation = this.generation;
    const key = await this.authenticate(this.state!.snapshot!, proof, true);
    this.guard(generation); await this.assertCurrent();
    return key;
  }

  private async records(): Promise<VaultCredential[]> {
    await this.assertCurrent();
    const snapshot = this.state!.snapshot!;
    const key = this.key!;
    const generation = this.generation;
    const result = await Promise.all(snapshot.records.map(async record => {
      const value = credential(await decryptJSON<VaultCredential>(key, record.ciphertext, context(snapshot, record)));
      if (value.id !== record.id) throw new VaultError("AUTHENTICATION");
      return value;
    }));
    this.guard(generation); return result;
  }

  /** Public names are advisory; only decrypted records authorize use of a value. */
  async keys(): Promise<{ entries: VaultKey[]; needsUnlock: boolean }> {
    return publicVaultKeys(await this.storage.read());
  }

  async list(): Promise<CredentialSummary[]> {
    return (await this.records()).map(({ value: _value, ...summary }) => summary);
  }

  async copyCredential(id: string): Promise<string> {
    const record = (await this.records()).find(item => item.id === id);
    if (!record) throw new VaultError("INVALID");
    await this.assertCurrent();
    return record.value;
  }

  private async save(values: VaultCredential[], envelopes = this.state!.snapshot!.envelopes,
    key = this.key!, epoch = this.state!.snapshot!.epoch): Promise<void> {
    await this.assertCurrent();
    if (values.length > vaultLimits.records) throw new VaultError("LIMIT");
    const generation = this.generation;
    const expected = this.state!;
    const previous = expected.snapshot!;
    const base = { id: previous.id, epoch, revision: previous.revision + 1, envelopes };
    const records = await Promise.all(values.map(async value => {
      credential(value);
      const record = { id: value.id, kind: "credential" as const,
        revision: (previous.records.find(item => item.id === value.id)?.revision ?? 0) + 1 };
      return { ...record, ciphertext: await encryptJSON(key, value, context(base, record)) };
    }));
    const snapshot = await sealSnapshot({ ...base, records }, key);
    await authenticateManifest(snapshot, key);
    this.guard(generation);
    const state = await this.storage.replace(expected, snapshot, values.map(({ id, label, kind }) => ({ id, label, kind })));
    this.guard(generation); this.state = state; this.key = key;
  }

  async put(proof: UnlockProof | null, input: { id?: string; label: string; kind: VaultCredential["kind"]; value: string }): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const records = await this.records();
    const previous = input.id ? records.find(item => item.id === input.id) : undefined;
    if (input.id && !previous) throw new VaultError("INVALID");
    const value = credential({ id: previous?.id ?? crypto.randomUUID(), label: input.label, kind: input.kind,
      value: input.value, grants: previous?.kind === input.kind ? previous.grants : [] });
    const key = value.label.trim().normalize("NFC").toLowerCase();
    if (records.some(item => item.id !== value.id && item.label.trim().normalize("NFC").toLowerCase() === key))
      throw new VaultError("DUPLICATE_KEY");
    await this.save([...records.filter(item => item.id !== value.id), value]);
    return this.list();
  }

  async remove(proof: UnlockProof | null, id: string): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const values = await this.records();
    if (!values.some(item => item.id === id)) throw new VaultError("INVALID");
    await this.save(values.filter(item => item.id !== id));
    return this.list();
  }

  async grant(proof: UnlockProof | null, id: string, scheme: string, input: ApprovedOperation): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const descriptor = await approvedOperation(input.operation, input.origin);
    if (descriptor.fingerprint !== input.fingerprint) throw new VaultError("PERMISSION");
    await this.assertSchema(descriptor);
    const values = await this.records();
    const value = values.find(item => item.id === id);
    if (!value || !descriptor.operation.security?.some(option => option.some(item => item.name === scheme && (value.kind === "secret" || item.kind === value.kind))))
      throw new VaultError("PERMISSION");
    value.grants = [...value.grants.filter(item => !(item.scheme === scheme && item.descriptor.operation.id === descriptor.operation.id)),
      { id: crypto.randomUUID(), scheme, descriptor }];
    await this.save(values); return this.list();
  }

  async revoke(proof: UnlockProof | null, id: string, grantId: string): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const values = await this.records();
    const value = values.find(item => item.id === id);
    if (!value || !value.grants.some(item => item.id === grantId)) throw new VaultError("INVALID");
    value.grants = value.grants.filter(item => item.id !== grantId);
    await this.save(values); return this.list();
  }

  async checkAssertion(expression: import("./processing.ts").PrivateExpression, data: import("../workflow-processing.ts").ProcessingData): Promise<boolean> {
    const generation = this.generation;
    const result = await checkPrivateAssertion(expression, data, await this.records());
    this.guard(generation);
    await this.assertCurrent();
    return result;
  }

  async execute(descriptor: ApprovedOperation, values: InputValues, binding: CredentialBinding, signal?: AbortSignal, variables?: import("./variables.ts").VaultVariableInput[]) {
    return executeCredentialed(descriptor, values, binding, await this.records(), {
      ...(signal ? { signal } : {}), ...(variables ? { variables } : {}), assertCurrent: async () => {
        await this.assertSchema(descriptor);
        await this.assertCurrent();
      },
    });
  }

  async backup(proof?: UnlockProof, forReplacement = false): Promise<string> {
    if (proof && !forReplacement) {
      await this.fresh(proof);
      return canonicalJSON(this.state!.snapshot!);
    }
    const generation = this.generation;
    const state = await this.storage.read();
    if (!state.snapshot) throw new VaultError("LOCKED");
    const snapshot = validateSnapshot(state.snapshot);
    if (forReplacement && !proof) throw new VaultError("AUTHENTICATION");
    if (proof) await this.authenticate(snapshot, proof);
    this.guard(generation);
    return canonicalJSON(snapshot);
  }

  async restore(input: string, proof: UnlockProof, currentProof?: UnlockProof, expectedExport?: string): Promise<VaultStatus> {
    if (typeof input !== "string" || new TextEncoder().encode(input).byteLength > vaultLimits.backupBytes) throw new VaultError("LIMIT");
    const generation = this.generation;
    const expected = await this.storage.read();
    if (expectedExport !== undefined && (!expected.snapshot || canonicalJSON(expected.snapshot) !== expectedExport))
      throw new VaultError("CONFLICT");
    if (expected.snapshot) {
      if (!currentProof) throw new VaultError("AUTHENTICATION");
      await this.authenticate(validateSnapshot(expected.snapshot), currentProof);
    }
    let snapshot: VaultSnapshot;
    try { snapshot = validateSnapshot(JSON.parse(input)); } catch { throw new VaultError("INVALID"); }
    const key = await this.authenticate(snapshot, proof);
    const keys: VaultKey[] = [];
    const records = await Promise.all(snapshot.records.map(async record => {
      const value = credential(await decryptJSON<VaultCredential>(key, record.ciphertext, context(snapshot, record)));
      if (value.id !== record.id) throw new VaultError("AUTHENTICATION");
      keys.push({ id: value.id, label: value.label, kind: value.kind });
      value.grants = []; // Imported IDs and policies never authorize a destination in this installation.
      const next = { ...record, revision: record.revision + 1 };
      return { ...next, ciphertext: await encryptJSON(key, value, context(snapshot, next)) };
    }));
    const next = await sealSnapshot({ id: snapshot.id, epoch: snapshot.epoch, envelopes: snapshot.envelopes,
      revision: snapshot.revision + 1, records }, key);
    this.guard(generation);
    const state = await this.storage.replace(expected, next, keys);
    this.guard(generation); this.state = state; this.key = key;
    return this.status();
  }

  async addMethod(proof: UnlockProof, material: Exclude<Enrollment, { kind: "recovery" }>, replaceId?: string): Promise<VaultStatus> {
    const key = await this.fresh(proof);
    if (!["password", "passkey"].includes(material.kind)) throw new VaultError("INVALID");
    const snapshot = this.state!.snapshot!;
    if (replaceId && !snapshot.envelopes.some(item => item.id === replaceId && item.kind === material.kind)) throw new VaultError("INVALID");
    const envelope = await this.enroll(key, snapshot, material);
    await this.save(await this.records(), [...snapshot.envelopes.filter(item => item.id !== replaceId), envelope]);
    return this.status();
  }

  async removeMethod(proof: UnlockProof, id: string): Promise<VaultStatus> {
    await this.fresh(proof);
    const envelopes = this.state!.snapshot!.envelopes;
    if (envelopes.length <= 1 || !envelopes.some(item => item.id === id) || proof.methodId === id) throw new VaultError("INVALID");
    await this.save(await this.records(), envelopes.filter(item => item.id !== id));
    return this.status();
  }

  async rotate(proofs: UnlockProof[]): Promise<VaultStatus & { recovery: string }> {
    await this.assertCurrent();
    const snapshot = this.state!.snapshot!;
    const retained = snapshot.envelopes.filter(envelope => envelope.kind !== "recovery");
    if (!retained.length || proofs.length !== retained.length || new Set(proofs.map(item => item.methodId)).size !== proofs.length) throw new VaultError("AUTHENTICATION");
    const generation = this.generation;
    const newKey = await newVaultKey();
    const epoch = snapshot.epoch + 1;
    const envelopes: KeyEnvelope[] = [];
    for (const envelope of retained) {
      const proof = proofs.find(item => item.methodId === envelope.id);
      if (!proof) throw new VaultError("AUTHENTICATION");
      await this.fresh(proof);
      const kek = await wrappingKey(envelope, proof);
      const next = { ...envelope, revision: envelope.revision + 1 };
      const wrappedKey = await wrapVaultKey(newKey, kek, context({ ...snapshot, epoch }, next));
      await unwrapVaultKey(wrappedKey, kek, context({ ...snapshot, epoch }, next));
      envelopes.push({ ...next, wrappedKey });
    }
    const recovery = randomBase64(recoveryKeyBytes);
    envelopes.push(await this.enroll(newKey, { ...snapshot, epoch }, { kind: "recovery", secret: recovery }));
    this.guard(generation);
    await this.save(await this.records(), envelopes, await runtimeKey(newKey), epoch);
    return { ...await this.status(), recovery };
  }
}
