// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { JiraCompanionBroker, validateJiraState, jiraAccessKeyHash, type JiraCompanionRuntime, type JiraCompanionState } from "./jira-companion.ts";
import { jiraOAuthAlternative, validateJiraMetadata, type JiraOAuthInput } from "./jira-config.ts";
import { validateGitlabMetadata } from "./gitlab-config.ts";
import { GitlabOAuthBroker, managedGitlabSecrets, validateGitlabTokenState, type GitlabOAuthRuntime } from "./gitlab-oauth.ts";
import { gitlabOAuthAlternative, type GitlabOAuthInput, type GitlabOAuthCallback } from "./gitlab-config.ts";
import { CloudflareUploadSessions } from "./cloudflare-upload.ts";
import { prepareRequest, type InputValues } from "../operation-input.ts";
import { decryptJSON, encryptJSON, newVaultKey, passwordKey, recoveryKey, passkeyKey, randomBase64,
  runtimeKey, unwrapVaultKey, wrapVaultKey, validId, canonicalJSON, ownObject } from "./crypto.ts";
import { authenticateManifest, sealSnapshot, validateSnapshot } from "./format.ts";
import { validateApprovedOperation, approvedOperation } from "./policy.ts";
import { approvedNativeOperation, type ApprovedNativeOperation } from "./native-rpc-policy.ts";
import { NativeRuntimeBroker, type NativeRuntimeRuntime } from "./native-runtime.ts";
import { NativeAgentBroker } from "./native-agent.ts";
import { nativeAgentMethods, isNativeWorkflowMethod, type NativeDecision, type NativeLoginKind, type NativeProgressCallback,
  type NativeExecutionResult } from "../native-agent-contract.ts";
import { nativeHash, storedNativeConnections, validateNativeConnection, validateNativeInput, validateNativeReference,
  type NativeRuntimeInput, type NativeRuntimeReference } from "./native-runtime-config.ts";
import { nativeRuntimeProfile, nativeRuntimeVersion, nativeObject, nativeUuid } from "../native-runtime-contract.ts";
import { publicVaultKeys } from "./key-index.ts";
import { executeCredentialed, CredentialResponseError, redactor } from "./execution.ts";
import { connectionCredentialIds, createHttpConnection, createGitlabHttpConnection, createJiraHttpConnection, httpConnectionLimit, httpConnectionReference, resolveHttpConnection,
  storedHttpConnections, validateHttpConnection, invalidateHttpConnections } from "./http-connections.ts";
import type { HttpConnectionInput } from "./types.ts";
import { validateCredentialBinding, validateHttpConnectionReference } from "./bindings.ts";
import type { ResponseProgressCallback } from "../workflow-response-stream.ts";
import { checkPrivateAssertion } from "./processing.ts";
import { VaultError, passwordProfile, vaultLimits, recoveryKeyBytes, recoveryKeyCharacters } from "./types.ts";
import type { ApprovedOperation, CredentialBinding, CredentialSummary, CryptoContext, Enrollment,
  KeyEnvelope, UnlockProof, VaultCredential, VaultSnapshot, VaultStatus, VaultKey, HttpConnectionReference } from "./types.ts";
import type { VaultState, VaultStorage } from "./storage.ts";

type Pending = { state: VaultState; snapshot: VaultSnapshot; key: CryptoKey; recovery: string };
const context = (snapshot: Pick<VaultSnapshot, "id" | "epoch">, item: { id: string; kind: string; revision: number }): CryptoContext =>
  ({ vaultId: snapshot.id, epoch: snapshot.epoch, kind: item.kind, id: item.id, revision: item.revision });

function credential(value: VaultCredential): VaultCredential {
  ownObject(value, ["id", "label", "kind", "value", "grants"], ["connections", "nativeConnections", "oauthState"]);
  if (!validId(value.id) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 120
    || !["bearer", "apiKey", "secret"].includes(value.kind) || typeof value.value !== "string" || !value.value
    || /[^\x21-\x7e]/.test(value.value) || value.value.length > vaultLimits.secretBytes
    || !Array.isArray(value.grants) || value.grants.length > 256) throw new VaultError("INVALID");
  canonicalJSON(value, vaultLimits.recordBytes);
  if (value.connections !== undefined) {
    if (!Array.isArray(value.connections) || value.connections.length > 32) throw new VaultError("LIMIT");
    value.connections.forEach(validateHttpConnection);
  }
  if (value.nativeConnections !== undefined) {
    if (!Array.isArray(value.nativeConnections) || value.nativeConnections.length > 32) throw new VaultError("LIMIT");
    value.nativeConnections.forEach(validateNativeConnection);
  }
  if (value.oauthState !== undefined) {
    if (typeof value.oauthState !== "string" || new TextEncoder().encode(value.oauthState).byteLength > vaultLimits.secretBytes
      || !value.connections?.some(connection => ["gitlab-oauth", "jira-companion"].includes(connection.format))) throw new VaultError("INVALID");
    const jira = value.connections?.find(connection => connection.format === "jira-companion");
    if (jira) validateJiraState(value.oauthState, validateJiraMetadata(jira.oauth));
    else validateGitlabTokenState(value.oauthState);
  }
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
  private readonly assertSchema: (descriptor: Pick<ApprovedOperation, "fingerprint" | "operation">) => Promise<void>;
  private state: VaultState | undefined;
  private key: CryptoKey | undefined;
  private generation = 0;
  private readonly uploadSessions = new CloudflareUploadSessions();
  private readonly gitlabOAuth: GitlabOAuthBroker;
  private readonly jiraCompanion: JiraCompanionBroker;
  private readonly nativeRuntime: NativeRuntimeBroker;
  private readonly nativeAgent: NativeAgentBroker;
  private pending: Pending | undefined;

  constructor(storage: VaultStorage, assertActive: () => void = () => {}, assertSchema: (descriptor: Pick<ApprovedOperation, "fingerprint" | "operation">) => Promise<void> = async () => {}, gitlabRuntime: GitlabOAuthRuntime = {}, jiraRuntime: JiraCompanionRuntime = {}, nativeRuntime: NativeRuntimeRuntime = {}) {
    this.storage = storage; this.assertActive = assertActive; this.assertSchema = assertSchema; this.gitlabOAuth = new GitlabOAuthBroker(gitlabRuntime); this.jiraCompanion = new JiraCompanionBroker(jiraRuntime);
    this.nativeRuntime = new NativeRuntimeBroker(nativeRuntime);
    this.nativeAgent = new NativeAgentBroker(this.nativeRuntime);
  }

  lock(): void { this.nativeRuntime.clear(); this.jiraCompanion.clear(); this.gitlabOAuth.clear(); this.uploadSessions.clear(); this.generation++; this.key = undefined; this.state = undefined; this.pending = undefined; }

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
    storedHttpConnections(result);
    storedNativeConnections(result);
    this.guard(generation); return result;
  }

  /** Public names are advisory; only decrypted records authorize use of a value. */
  async keys(): Promise<{ entries: VaultKey[]; needsUnlock: boolean }> {
    return publicVaultKeys(await this.storage.read());
  }

  async list(): Promise<CredentialSummary[]> {
    return (await this.records()).map(({ value: _value, oauthState: _oauthState, ...summary }) => summary);
  }

  async connections() { return storedHttpConnections(await this.records()); }

  async nativeConnections() {
    return storedNativeConnections(await this.records()).map(connection => ({ ...connection, connected: this.nativeRuntime.connected(connection.id) }));
  }

  private async nativeSelection(selection: Pick<ApprovedNativeOperation, "operation" | "document">): Promise<ApprovedNativeOperation> {
    const descriptor = await approvedNativeOperation(selection.operation, selection.document);
    if (descriptor.operation.id !== "codex:account/read" || descriptor.operation.rpc?.method !== "account/read"
      || descriptor.operation.rpc.version !== nativeRuntimeVersion) throw new VaultError("PERMISSION");
    await this.assertSchema(descriptor); return descriptor;
  }

  async pairNativeRuntime(value: NativeRuntimeInput, selection: Pick<ApprovedNativeOperation, "operation" | "document">, signal?: AbortSignal) {
    const generation = this.generation, input = validateNativeInput(value), descriptor = await this.nativeSelection(selection);
    const records = await this.records(), all = storedNativeConnections(records), record = records.find(item => item.id === input.pairingKeyId);
    if (!record || record.oauthState !== undefined) throw new VaultError("PERMISSION");
    if (all.length >= 32) throw new VaultError("LIMIT");
    const id = crypto.randomUUID();
    const guard = async () => { this.guard(generation); await this.assertCurrent(); await this.assertSchema(descriptor); this.guard(generation); };
    try {
      const result = await this.nativeRuntime.check(id, input.host, record.value, descriptor.fingerprint, undefined, guard, signal);
      const config = { id, revision: 1, profile: nativeRuntimeProfile, ...input, keyHash: await nativeHash(record.value),
        identity: result.identity, modelFingerprint: descriptor.fingerprint, accountType: result.accountType };
      const connection = validateNativeConnection({ ...config, fingerprint: await nativeHash(config) });
      record.nativeConnections = [...record.nativeConnections ?? [], connection];
      await guard(); await this.save(records); this.guard(generation);
      return { ...connection, connected: true };
    } catch (error) { this.nativeRuntime.close(id); throw error; }
  }

  async checkNativeRuntime(value: NativeRuntimeReference, selection: Pick<ApprovedNativeOperation, "operation" | "document">, signal?: AbortSignal) {
    const generation = this.generation, reference = validateNativeReference(value);
    try {
      const descriptor = await this.nativeSelection(selection);
      const records = await this.records(), connection = storedNativeConnections(records).find(item => item.id === reference.id);
      if (!connection || connection.revision !== reference.revision || connection.fingerprint !== reference.fingerprint) throw new VaultError("CONFLICT");
      const record = records.find(item => item.id === connection.pairingKeyId);
      const { fingerprint, ...config } = connection;
      if (!record || connection.keyHash !== await nativeHash(record.value) || connection.modelFingerprint !== descriptor.fingerprint
        || fingerprint !== await nativeHash(config)) { this.nativeRuntime.close(reference.id); throw new VaultError("AUTHORIZATION"); }
      const guard = async () => { this.guard(generation); await this.assertCurrent(); await this.assertSchema(descriptor); this.guard(generation); };
      const result = await this.nativeRuntime.check(connection.id, connection.host, record.value, descriptor.fingerprint, connection.identity, guard, signal);
      if (result.accountType !== connection.accountType) throw new VaultError("AUTHORIZATION");
      return { ...connection, connected: true };
    } catch (error) { this.nativeRuntime.close(reference.id); throw error; }
  }

  async disconnectNativeRuntime(value: NativeRuntimeReference, remove = false) {
    if (typeof remove !== "boolean") throw new VaultError("INVALID");
    const reference = validateNativeReference(value), records = await this.records();
    const connection = storedNativeConnections(records).find(item => item.id === reference.id);
    if (!connection || connection.revision !== reference.revision || connection.fingerprint !== reference.fingerprint) throw new VaultError("CONFLICT");
    this.nativeRuntime.close(connection.id);
    if (remove) {
      const owner = records.find(item => item.id === connection.pairingKeyId)!;
      owner.nativeConnections = owner.nativeConnections!.filter(item => item.id !== connection.id);
      if (!owner.nativeConnections.length) delete owner.nativeConnections;
      await this.save(records);
    }
    return this.nativeConnections();
  }

  private async nativeWorkflowAuthority(value: NativeRuntimeReference,
    selections: Pick<ApprovedNativeOperation, "operation" | "document">[], requireEnabled = true) {
    const generation = this.generation, reference = validateNativeReference(value);
    if (!Array.isArray(selections) || selections.length !== nativeAgentMethods.length) throw new VaultError("PERMISSION");
    const descriptors: ApprovedNativeOperation[] = [];
    for (let index = 0; index < nativeAgentMethods.length; index++) {
      const descriptor = await approvedNativeOperation(selections[index]!.operation, selections[index]!.document);
      if (descriptor.operation.id !== "codex:" + nativeAgentMethods[index] || descriptor.operation.rpc?.version !== nativeRuntimeVersion)
        throw new VaultError("PERMISSION");
      descriptors.push(descriptor);
    }
    const workflowFingerprint = await nativeHash(descriptors.map(descriptor => ({ method: descriptor.operation.rpc!.method, fingerprint: descriptor.fingerprint })));
    const records = await this.records(), connection = storedNativeConnections(records).find(item => item.id === reference.id);
    if (!connection || connection.revision !== reference.revision || connection.fingerprint !== reference.fingerprint) throw new VaultError("CONFLICT");
    const record = records.find(item => item.id === connection.pairingKeyId), { fingerprint, ...config } = connection;
    if (!record || record.oauthState !== undefined || connection.keyHash !== await nativeHash(record.value)
      || connection.modelFingerprint !== descriptors.find(item => item.operation.rpc!.method === "account/read")!.fingerprint
      || fingerprint !== await nativeHash(config) || requireEnabled && connection.workflowFingerprint !== workflowFingerprint) throw new VaultError("AUTHORIZATION");
    const guard = async () => {
      this.guard(generation); await this.assertCurrent();
      for (const descriptor of descriptors) await this.assertSchema(descriptor);
      this.guard(generation);
    };
    await guard(); return { connection, record, records, descriptors, workflowFingerprint, guard };
  }

  async enableNativeWorkflow(value: NativeRuntimeReference, selections: Pick<ApprovedNativeOperation, "operation" | "document">[]) {
    const authority = await this.nativeWorkflowAuthority(value, selections, false);
    const { fingerprint: _old, ...previous } = authority.connection;
    const config = { ...previous, revision: previous.revision + 1, workflowFingerprint: authority.workflowFingerprint };
    const connection = validateNativeConnection({ ...config, fingerprint: await nativeHash(config) });
    authority.record.nativeConnections = authority.record.nativeConnections!.map(item => item.id === connection.id ? connection : item);
    this.nativeRuntime.close(connection.id); await authority.guard(); await this.save(authority.records);
    return { ...connection, connected: false };
  }

  private nativeProgress(records: VaultCredential[], progress?: NativeProgressCallback): NativeProgressCallback {
    return value => {
      this.assertActive();
      const scrub = redactor(records.flatMap(record => [record.value, ...managedGitlabSecrets(record.oauthState ?? "")]).sort((a, b) => b.length - a.length));
      const safe = scrub.value(value) as typeof value;
      if (scrub.changed) throw new VaultError("REDACTED"); progress?.(safe);
    };
  }

  async loginNativeRuntime(value: NativeRuntimeReference, selections: Pick<ApprovedNativeOperation, "operation" | "document">[],
    input: { type: NativeLoginKind; credentialId?: string }, signal?: AbortSignal, progress?: NativeProgressCallback) {
    const authority = await this.nativeWorkflowAuthority(value, selections);
    nativeObject(input, input.type === "apiKey" ? ["type", "credentialId"] : ["type"]);
    if (!["apiKey", "chatgpt", "chatgptDeviceCode"].includes(input.type)) throw new VaultError("PERMISSION");
    let login: unknown = { type: input.type };
    if (input.type === "apiKey") {
      const credential = authority.records.find(item => item.id === input.credentialId);
      if (!credential || credential.oauthState !== undefined || credential.id === authority.record.id) throw new VaultError("PERMISSION");
      login = { type: "apiKey", apiKey: credential.value };
    }
    try {
      const result = await this.nativeAgent.login(authority.connection, authority.record.value, authority.workflowFingerprint, login,
        authority.guard, signal, this.nativeProgress(authority.records, progress));
      await authority.guard();
      if (signal?.aborted) throw new VaultError("CANCELLED");
      const { fingerprint: _old, ...previous } = authority.connection;
      const config = { ...previous, revision: previous.revision + 1, identity: result.identity, accountType: result.accountType };
      const connection = validateNativeConnection({ ...config, fingerprint: await nativeHash(config) });
      authority.record.nativeConnections = authority.record.nativeConnections!.map(item => item.id === connection.id ? connection : item);
      await this.save(authority.records, undefined, undefined, undefined, signal); return { ...connection, connected: true };
    } catch (error) { this.nativeRuntime.close(value.id); throw error; }
  }

  async executeNativeRuntime(value: NativeRuntimeReference, selections: Pick<ApprovedNativeOperation, "operation" | "document">[],
    selection: Pick<ApprovedNativeOperation, "operation" | "document">, input: unknown, signal?: AbortSignal,
    progress?: NativeProgressCallback): Promise<NativeExecutionResult> {
    const authority = await this.nativeWorkflowAuthority(value, selections);
    const descriptor = await approvedNativeOperation(selection.operation, selection.document), method = descriptor.operation.rpc!.method;
    if (!isNativeWorkflowMethod(method) || !authority.descriptors.some(item => item.fingerprint === descriptor.fingerprint)) throw new VaultError("PERMISSION");
    const inputScrub = redactor(authority.records.map(record => record.value)); inputScrub.value(input);
    if (inputScrub.changed) throw new VaultError("REDACTED");
    try {
      const result = await this.nativeAgent.execute(authority.connection, authority.record.value, authority.workflowFingerprint,
        method, input, authority.guard, signal, this.nativeProgress(authority.records, progress));
      const scrub = redactor(authority.records.flatMap(record => [record.value, ...managedGitlabSecrets(record.oauthState ?? "")]).sort((a, b) => b.length - a.length));
      const safe = scrub.value(result);
      if (scrub.changed) throw new VaultError("REDACTED");
      await authority.guard();
      return { request: { protocol: "json-rpc", method, params: structuredClone(input) as Record<string, unknown> }, response: { protocol: "json-rpc", result: safe } };
    } catch (error) { this.nativeRuntime.close(value.id); throw error; }
  }

  async replyNativeRuntime(connectionId: string, token: string, decision: NativeDecision) {
    if (!nativeUuid(connectionId) || !nativeUuid(token)) throw new VaultError("INVALID");
    await this.assertCurrent(); return this.nativeAgent.reply(connectionId, token, decision);
  }

  async connectionBinding(reference: HttpConnectionReference, descriptor: ApprovedOperation): Promise<CredentialBinding> {
    const approved = await approvedOperation(descriptor.operation, descriptor.origin);
    if (approved.fingerprint !== descriptor.fingerprint) throw new VaultError("PERMISSION");
    await this.assertSchema(approved);
    const records = await this.records(), selected = validateHttpConnectionReference(reference);
    const connection = storedHttpConnections(records).find(item => item.id === selected.id);
    if (!connection) throw new VaultError("PERMISSION");
    const binding = { alternative: connection.alternative, credentials: {}, fingerprint: approved.fingerprint, connection: selected };
    const resolved = await resolveHttpConnection(approved, binding, records);
    if (resolved.format === "gitlab-oauth" && resolved.oauth) {
      const oauth = validateGitlabMetadata(resolved.oauth);
      this.gitlabOAuth.assertMetadata(oauth);
      const id = resolved.binding.credentials.oauth2;
      const record = typeof id === "string" && records.find(item => item.id === id);
      if (!record || validateGitlabTokenState(record.oauthState ?? "", oauth).refreshPending) throw new VaultError("AUTHORIZATION");
    }
    if (resolved.format === "jira-companion") {
      const id = resolved.binding.credentials.OAuth2, record = typeof id === "string" && records.find(item => item.id === id);
      if (!record) throw new VaultError("AUTHORIZATION");
      const state = validateJiraState(record.oauthState ?? "", validateJiraMetadata(resolved.oauth)); this.jiraCompanion.assertState(state);
      await this.jiraKey(state.accessKeyId, state.accessKeyHash);
    }
    await this.assertCurrent();
    return binding;
  }

  async putConnection(input: HttpConnectionInput, descriptor: ApprovedOperation, binding: CredentialBinding) {
    const records = await this.records();
    const connection = await createHttpConnection(input, descriptor, binding, records);
    await this.assertSchema(descriptor);
    for (const record of records) if (record.connections) {
      record.connections = record.connections.filter(item => item.id !== connection.id);
      if (!record.connections.length) delete record.connections;
    }
    const owner = records.find(record => record.id === connectionCredentialIds(connection)[0]);
    if (!owner) throw new VaultError("PERMISSION");
    owner.connections = [...owner.connections ?? [], connection];
    await this.save(records);
    return connection;
  }

  private async jiraKey(id: string, expected?: string): Promise<string> {
    const record = (await this.records()).find(item => item.id === id);
    if (!record || record.kind !== "secret" || record.oauthState || expected !== undefined && await jiraAccessKeyHash(record.value) !== expected)
      throw new VaultError("AUTHORIZATION");
    await jiraAccessKeyHash(record.value); return record.value;
  }
  async beginJiraOAuth(value: JiraOAuthInput, descriptor: ApprovedOperation, replace?: HttpConnectionReference, signal?: AbortSignal) {
    const generation = this.generation; await this.assertCurrent();
    const approved = await validateApprovedOperation(descriptor);
    if (jiraOAuthAlternative(approved) === undefined) throw new VaultError("PERMISSION");
    await this.assertSchema(approved);
    const records = await this.records();
    if (replace) {
      replace = validateHttpConnectionReference(replace);
      const previous = storedHttpConnections(records).find(item => item.id === replace!.id);
      if (previous?.format !== "jira-companion" || previous.oauth?.profile !== "atlassian-jira-3lo-v1" || previous.oauth.host !== value.host)
        throw new VaultError("PERMISSION");
      await resolveHttpConnection(approved, { alternative: previous.alternative, credentials: {}, fingerprint: approved.fingerprint, connection: replace }, records);
    }
    const key = await this.jiraKey(value.accessKeyId), expected = await jiraAccessKeyHash(key);
    const guard = async () => { this.guard(generation); await this.assertSchema(approved); await this.assertCurrent(); await this.jiraKey(value.accessKeyId, expected); this.guard(generation); };
    const task = await this.jiraCompanion.begin(value, approved, key, guard, replace, signal); this.guard(generation); return task;
  }
  async pollJiraOAuth(id: string, signal?: AbortSignal) {
    const generation = this.generation, pending = this.jiraCompanion.pendingInput(id);
    const guard = async () => { this.guard(generation); await this.assertSchema(pending.descriptor); await this.assertCurrent();
      await this.jiraKey(pending.input.accessKeyId, pending.accessKeyHash); this.guard(generation); };
    return this.jiraCompanion.poll(id, guard, signal);
  }
  async cancelJiraOAuth(id: string) { await this.assertCurrent(); await this.jiraCompanion.cancel(id); }
  async completeJiraOAuth(id: string, cloudId: string, signal?: AbortSignal) {
    const generation = this.generation, pending = this.jiraCompanion.pendingInput(id);
    const guard = async () => { this.guard(generation); await this.assertSchema(pending.descriptor); await this.assertCurrent();
      await this.jiraKey(pending.input.accessKeyId, pending.accessKeyHash); this.guard(generation); };
    try {
      const state = await this.jiraCompanion.select(id, cloudId, guard, signal); await guard();
      if (signal?.aborted) throw new VaultError("CANCELLED");
      const records = await this.records(), connections = storedHttpConnections(records);
      const previous = pending.replace && connections.find(item => item.id === pending.replace!.id);
      if (pending.replace && (!previous || previous.format !== "jira-companion" || previous.revision !== pending.replace.revision
        || previous.fingerprint !== pending.replace.fingerprint || canonicalJSON(previous.oauth) !== canonicalJSON(state.oauth))) throw new VaultError("AUTHORIZATION");
      if (!previous && connections.length >= httpConnectionLimit) throw new VaultError("LIMIT");
      if (connections.some(item => item.id !== previous?.id && item.provider === pending.descriptor.operation.id.split(":")[0]
        && item.label.trim().toLowerCase() === pending.input.label.toLowerCase())) throw new VaultError("DUPLICATE_KEY");
      const credentialId = previous ? connectionCredentialIds(previous)[0]! : crypto.randomUUID();
      const connection = await createJiraHttpConnection(pending.descriptor, credentialId, pending.input.label, state.oauth, pending.replace);
      const key = await this.jiraKey(state.accessKeyId, state.accessKeyHash);
      if ([key, state.capability].some(secret => JSON.stringify(connection).includes(secret))) throw new VaultError("AUTHORIZATION");
      const record: VaultCredential = { id: credentialId, label: pending.input.label + " reference", kind: "secret", value: crypto.randomUUID(),
        oauthState: JSON.stringify(state), grants: [], connections: [connection] };
      if (records.some(item => item.id !== credentialId && item.label.trim().normalize("NFC").toLowerCase() === record.label.trim().normalize("NFC").toLowerCase())) throw new VaultError("DUPLICATE_KEY");
      if (previous) {
        const old = records.find(item => item.id === credentialId);
        if (!old) throw new VaultError("AUTHORIZATION");
        await this.jiraCompanion.remove(validateJiraState(old.oauthState ?? "", validateJiraMetadata(previous.oauth)), key, guard);
      }
      await guard(); if (signal?.aborted) throw new VaultError("CANCELLED");
      await this.save([...records.filter(item => item.id !== credentialId), record]); this.guard(generation);
      this.jiraCompanion.forget(id); return connection;
    } catch (error) { await this.jiraCompanion.cancel(id).catch(() => {}); throw error; }
  }

  async beginGitlabOAuth(input: GitlabOAuthInput, descriptor: ApprovedOperation, replace?: HttpConnectionReference) {
    const generation = this.generation; await this.assertCurrent();
    const approved = await validateApprovedOperation(descriptor);
    if (gitlabOAuthAlternative(approved) === undefined) throw new VaultError("PERMISSION");
    await this.assertSchema(approved);
    if (replace) {
      const records = await this.records(), selected = validateHttpConnectionReference(replace);
      const connection = storedHttpConnections(records).find(item => item.id === selected.id);
      if (!connection || connection.format !== "gitlab-oauth" || connection.oauth?.clientId !== input.clientId
        || connection.oauth.redirectUri !== input.redirectUri) throw new VaultError("PERMISSION");
      await resolveHttpConnection(approved, { alternative: connection.alternative, credentials: {}, fingerprint: approved.fingerprint, connection: selected }, records);
      replace = selected;
    }
    const task = await this.gitlabOAuth.begin(input, approved, replace); this.guard(generation); return task;
  }
  async cancelGitlabOAuth(id: string) { await this.assertCurrent(); this.gitlabOAuth.cancel(id); }
  async completeGitlabOAuth(id: string, callback: GitlabOAuthCallback, signal?: AbortSignal) {
    const generation = this.generation; await this.assertCurrent();
    const { pending, code } = this.gitlabOAuth.take(id, callback);
    const guard = async () => { this.guard(generation); await this.assertSchema(pending.descriptor); await this.assertCurrent(); this.guard(generation); };
    const state = await this.gitlabOAuth.exchange(pending, code, signal, guard);
    await guard(); if (signal?.aborted) throw new VaultError("CANCELLED");
    const records = await this.records();
    const previous = pending.replace && storedHttpConnections(records).find(item => item.id === pending.replace!.id);
    if (pending.replace && (!previous || previous.format !== "gitlab-oauth" || previous.revision !== pending.replace.revision
      || previous.fingerprint !== pending.replace.fingerprint || previous.oauth?.accountId !== state.oauth.accountId
      || canonicalJSON(previous.oauth) !== canonicalJSON(state.oauth))) throw new VaultError("AUTHORIZATION");
    const credentialId = previous ? connectionCredentialIds(previous)[0]! : crypto.randomUUID();
    if (storedHttpConnections(records).some(item => item.id !== previous?.id && item.label.trim().toLowerCase() === pending.input.label.toLowerCase()
      && item.provider === pending.descriptor.operation.id.split(":")[0])) throw new VaultError("DUPLICATE_KEY");
    let username = state.username;
    if ([state.accessToken, state.refreshToken, pending.verifier, code].some(secret => username.includes(secret))) username = state.oauth.accountId;
    const connection = await createGitlabHttpConnection(pending.descriptor, credentialId, pending.input.label, username, state.oauth, pending.replace);
    if ([state.accessToken, state.refreshToken, pending.verifier, code].some(secret => JSON.stringify(connection).includes(secret))) throw new VaultError("AUTHORIZATION");
    const record: VaultCredential = { id: credentialId, label: pending.input.label + " reference", kind: "secret", value: crypto.randomUUID(), oauthState: JSON.stringify(state), grants: [], connections: [connection] };
    if (records.some(item => item.id !== credentialId && item.label.trim().normalize("NFC").toLowerCase() === record.label.trim().normalize("NFC").toLowerCase())) throw new VaultError("DUPLICATE_KEY");
    await guard(); if (signal?.aborted) throw new VaultError("CANCELLED"); await this.save([...records.filter(item => item.id !== credentialId), record]);
    this.guard(generation); return connection;
  }

  async removeConnection(reference: HttpConnectionReference) {
    const selected = validateHttpConnectionReference(reference), records = await this.records();
    const connection = storedHttpConnections(records).find(item => item.id === selected.id);
    if (!connection || connection.revision !== selected.revision || connection.fingerprint !== selected.fingerprint) throw new VaultError("CONFLICT");
    if (connection.format === "jira-companion") {
      const id = connectionCredentialIds(connection)[0]!, record = records.find(item => item.id === id);
      if (!record) throw new VaultError("AUTHORIZATION");
      const state = validateJiraState(record.oauthState ?? "", validateJiraMetadata(connection.oauth)), key = await this.jiraKey(state.accessKeyId, state.accessKeyHash);
      record.oauthState = JSON.stringify({ ...state, disconnected: true }); await this.save(records);
      let remoteRemoved = true;
      try { await this.jiraCompanion.remove(state, key, async () => { await this.assertCurrent(); }); } catch { remoteRemoved = false; }
      await this.remove(null, id); return { remoteRemoved };
    }
    if (connection.format === "gitlab-oauth") { await this.remove(null, connectionCredentialIds(connection)[0]!); return; }
    for (const record of records) if (record.connections) {
      record.connections = record.connections.filter(item => item.id !== selected.id);
      if (!record.connections.length) delete record.connections;
    }
    await this.save(records);
  }

  async copyCredential(id: string): Promise<string> {
    const record = (await this.records()).find(item => item.id === id);
    if (!record) throw new VaultError("INVALID");
    await this.assertCurrent();
    return record.value;
  }

  private async save(values: VaultCredential[], envelopes = this.state!.snapshot!.envelopes,
    key = this.key!, epoch = this.state!.snapshot!.epoch, signal?: AbortSignal): Promise<void> {
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
    if (signal?.aborted) throw new VaultError("CANCELLED");
    const state = await this.storage.replace(expected, snapshot, values.map(({ id, label, kind }) => ({ id, label, kind })));
    this.guard(generation); this.uploadSessions.clear(); this.gitlabOAuth.invalidateTokenCache(); this.state = state; this.key = key;
  }

  async put(proof: UnlockProof | null, input: { id?: string; label: string; kind: VaultCredential["kind"]; value: string }): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const records = await this.records();
    const previous = input.id ? records.find(item => item.id === input.id) : undefined;
    if (input.id && !previous) throw new VaultError("INVALID");
    if (previous?.oauthState !== undefined) throw new VaultError("PERMISSION");
    const value = credential({ id: previous?.id ?? crypto.randomUUID(), label: input.label, kind: input.kind,
      value: input.value, grants: previous?.kind === input.kind ? previous.grants : [],
      ...(previous?.connections ? { connections: previous.connections } : {}),
      ...(previous?.nativeConnections ? { nativeConnections: previous.nativeConnections } : {}) });
    const key = value.label.trim().normalize("NFC").toLowerCase();
    if (records.some(item => item.id !== value.id && item.label.trim().normalize("NFC").toLowerCase() === key))
      throw new VaultError("DUPLICATE_KEY");
    const next = [...records.filter(item => item.id !== value.id), value];
    if (previous && (previous.value !== value.value || previous.kind !== value.kind)) {
      for (const connection of previous.nativeConnections ?? []) this.nativeRuntime.close(connection.id);
      delete value.nativeConnections; await invalidateHttpConnections(next, value.id);
    }
    await this.save(next);
    return this.list();
  }

  async remove(proof: UnlockProof | null, id: string): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const values = await this.records();
    if (!values.some(item => item.id === id)) throw new VaultError("INVALID");
    for (const connection of values.find(item => item.id === id)?.nativeConnections ?? []) this.nativeRuntime.close(connection.id);
    const next = values.filter(item => item.id !== id);
    for (const record of next) if (record.connections) {
      record.connections = record.connections.filter(item => !connectionCredentialIds(item).includes(id));
      if (!record.connections.length) delete record.connections;
    }
    await this.save(next);
    return this.list();
  }

  async grant(proof: UnlockProof | null, id: string, scheme: string, input: ApprovedOperation): Promise<CredentialSummary[]> {
    if (proof) await this.fresh(proof); else await this.assertCurrent();
    const descriptor = await approvedOperation(input.operation, input.origin);
    if (descriptor.fingerprint !== input.fingerprint) throw new VaultError("PERMISSION");
    await this.assertSchema(descriptor);
    const values = await this.records();
    const value = values.find(item => item.id === id);
    if (!value || !descriptor.operation.security?.some(option => option.every(item => item.kind !== "unsupported")
      && option.some(item => item.name === scheme && (item.kind === "basic" || value.kind === "secret" || item.kind === value.kind))))
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

  async checkAssertion(expression: import("./processing.ts").PrivateExpression, data: import("../workflow-processing.ts").ProcessingData, parameters?: Record<string, import("./processing.ts").PrivateExpression>): Promise<boolean> {
    const generation = this.generation;
    const result = await checkPrivateAssertion(expression, data, await this.records(), parameters);
    this.guard(generation);
    await this.assertCurrent();
    return result;
  }

  async execute(descriptor: ApprovedOperation, values: InputValues, binding: CredentialBinding, signal?: AbortSignal,
    variables?: import("./variables.ts").VaultVariableInput[], onProgress?: ResponseProgressCallback) {
    const generation = this.generation;
    descriptor = await validateApprovedOperation(descriptor); binding = validateCredentialBinding(binding);
    let records = await this.records(); const resolved = await resolveHttpConnection(descriptor, binding, records);
    if (resolved.format === "jira-companion") {
      if (jiraOAuthAlternative(descriptor) === undefined || variables?.length || Object.entries(values).some(([key, value]) => value !== undefined && key !== "query:expand"))
        throw new VaultError("PERMISSION");
      const id = resolved.binding.credentials.OAuth2, record = typeof id === "string" && records.find(item => item.id === id);
      if (!record) throw new VaultError("AUTHORIZATION");
      const state = validateJiraState(record.oauthState ?? "", validateJiraMetadata(resolved.oauth)), key = await this.jiraKey(state.accessKeyId, state.accessKeyHash);
      const guard = async () => { this.guard(generation); await this.assertSchema(descriptor); await this.assertCurrent();
        await this.jiraKey(state.accessKeyId, state.accessKeyHash); this.guard(generation); };
      const request = prepareRequest(descriptor.operation, values), expand = request.query.expand;
      if (expand !== undefined && typeof expand !== "string") throw new VaultError("INVALID");
      const response = await this.jiraCompanion.execute(state, key, expand, guard, signal);
      const secrets = records.flatMap(record => [record.value, ...managedGitlabSecrets(record.oauthState ?? ""),
        ...(record.oauthState && record.connections?.some(item => item.format === "jira-companion") ? [validateJiraState(record.oauthState).capability] : [])]);
      const scrub = redactor([...new Set(secrets.flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))].sort((a, b) => b.length - a.length));
      const safe = scrub.value(response) as typeof response; if (scrub.changed) safe.redacted = true;
      if (safe.status < 200 || safe.status >= 300) throw new CredentialResponseError("The endpoint returned HTTP " + safe.status + ". Check the request before retrying.", safe);
      return { request: scrub.value(request) as typeof request, response: safe };
    }
    const previousSecrets: string[] = [];
    if (resolved.format === "gitlab-oauth") {
      if (gitlabOAuthAlternative(descriptor) === undefined || !resolved.oauth) throw new VaultError("PERMISSION");
      await this.assertSchema(descriptor);
      const reference = resolved.binding.credentials.oauth2;
      if (typeof reference !== "string") throw new VaultError("PERMISSION");
      const record = records.find(item => item.id === reference); if (!record) throw new VaultError("PERMISSION");
      const original = record.oauthState ?? "", state = validateGitlabTokenState(original, validateGitlabMetadata(resolved.oauth));
      let expected = original;
      previousSecrets.push(...managedGitlabSecrets(original));
      const guard = async () => { this.guard(generation); await this.assertSchema(descriptor); await this.assertCurrent(); this.guard(generation); };
      await this.gitlabOAuth.ensure(reference, state, signal, guard, async next => {
        await guard(); const current = await this.records(), selected = current.find(item => item.id === reference);
        if (!selected || selected.oauthState !== expected) throw new VaultError("AUTHORIZATION");
        selected.oauthState = JSON.stringify(next); await this.save(current); expected = selected.oauthState; this.guard(generation);
      });
      records = await this.records();
    }
    return executeCredentialed(descriptor, values, binding, records, {
      uploadSessions: this.uploadSessions, privateSecrets: previousSecrets,
      ...(onProgress ? { onProgress: progress => { this.guard(generation); onProgress(progress); } } : {}),
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
    this.guard(generation); this.uploadSessions.clear(); this.state = state; this.key = key;
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
