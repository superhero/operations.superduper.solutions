// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import LightningFS from "@isomorphic-git/lightning-fs";
import { Buffer } from "buffer";
import * as git from "isomorphic-git";
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import { bundledCatalogs } from "./catalog-registry.ts";
import legacyExamples from "../catalogs/example-revisions.json" with { type: "json" };
import { operationServerUrl, validateSchemaDocument, validateSchemaDocumentId, type SchemaDocumentRecord } from "./schema-documents.ts";
import { catalogsDatabaseName, catalogsIndexDatabaseName } from "./storage-names.ts";
import { approvedOperation } from "./secrets/policy.ts";
import { VaultError } from "./secrets/types.ts";
import type { SchemaCredentialPolicies } from "./secrets/schema-policy-storage.ts";
import type { Operation, OperationModel } from "./catalog.ts";
import { scopeOperationSchema } from "./operation-report.ts";
import { createSchemaCache } from "./schema-cache.ts";
import { schemaModelBatchSize } from "./schema-models.ts";
import { applySchemaPatches, schemaPatchName, type SchemaPatch } from "./schema-patches.ts";
import { mergeSchemaDocuments, sameSchemaValue, schemaChanges, type SchemaConflict, type SchemaResolution } from "./schema-merge.ts";
import { schemaLineDiff, schemaPointerValue, type SchemaFieldDiff } from "./schema-diff.ts";
import { schemaDeletionReason } from "./schema-deletion.ts";
import { createSchemaDiscovery, createSchemaSummary, validateSchemaDiscovery, schemaIndexVersion, type SchemaDiscovery, type SchemaSummary } from "./schema-index.ts";

if (!("Buffer" in globalThis)) Object.defineProperty(globalThis, "Buffer", { value: Buffer, configurable: true, writable: true });

type IncomingSchema = { base: string; upstream: string; corrected: string; file: string; patches: SchemaPatch[] };
type SchemaBranches = { upstreamRevision?: string; correctedRevision?: string; patches?: SchemaPatch[]; incoming?: IncomingSchema };
export type SchemaMetadata = Omit<SchemaDocumentRecord, "document"> & SchemaBranches & { repositoryPath: string; factoryDigest?: string;
  revision?: string; gitRevision?: string; historyDigest?: string; adapterRevision?: string; summary?: SchemaSummary };
type SchemaDefaults = {
  catalogs: readonly { id: string; name: string; file: string; revision: string; enabled?: boolean; bytes?: number; summary?: SchemaSummary; patches?: SchemaPatch[] }[];
  adapterRevision?: string;
  read: (id: string) => Promise<Record<string, unknown>>;
  readUpstream?: (id: string) => Promise<Record<string, unknown>>;
  readIndex?: (id: string) => Promise<SchemaDiscovery>;
  inspectOperation?: (document: Record<string, unknown>, id: string, operation: Pick<Operation, "id" | "path" | "method">) => Operation;
  validate: (document: Record<string, unknown>, id: string) => ReturnType<typeof validateSchemaDocument>;
};
let defaults: SchemaDefaults | undefined;
let defaultSchemaIds = new Set(bundledCatalogs.map(catalog => catalog.id));
let currentExampleRevisions: Promise<string[]> | undefined;
const documents = createSchemaCache<Record<string, unknown>>(16 * 1024 * 1024);
const inspections = new WeakMap<object, Map<string, ReturnType<typeof validateSchemaDocument>>>();
/** Supply factory documents at the worker boundary; storage remains reusable with authored catalogs. */
export function configureSchemaDefaults(value: SchemaDefaults): void {
  defaults = value;
  defaultSchemaIds = new Set([...bundledCatalogs.map(catalog => catalog.id), ...value.catalogs.map(catalog => catalog.id)]);
  initialized = false;
}
/** Registered origin survives authored names, replacements and factory detachment. */
export function isBundledSchema(id: string): boolean { return defaultSchemaIds.has(id); }
function validateLibraryDocument(document: unknown, id: string) {
  const cached = document && typeof document === "object" ? inspections.get(document)?.get(id) : undefined;
  if (cached) return cached;
  const inspected = defaults?.catalogs.some(catalog => catalog.id === id)
    ? defaults.validate(document as Record<string, unknown>, id) : validateSchemaDocument(document, id);
  for (const value of [document, inspected.document]) if (value && typeof value === "object") {
    const sources = inspections.get(value) ?? new Map();
    sources.set(id, inspected); inspections.set(value, sources);
  }
  return inspected;
}
type RefUpdate = { ref: string; revision: string | null; previousRevision: string | null };
type PendingSchema = { metadata: SchemaMetadata; revision: string; previousRevision: string | null; refs?: RefUpdate[] };
interface SchemaDatabase extends DBSchema
{
  catalog: { key: string; value: SchemaMetadata };
  pending: { key: string; value: PendingSchema };
  removed: { key: string; value: true };
  indexes: { key: string; value: { identity: string; discovery: SchemaDiscovery } };
  policies: { key: string; value: SchemaCredentialPolicies[string] };
  state: { key: "seeded" | "vaultPolicy" | "serviceDefaults" | "exampleRevisions"; value: boolean | string[] | SchemaCredentialPolicies };
}
type StoreName = "catalog" | "pending" | "removed" | "state" | "indexes" | "policies";
type Database = IDBPDatabase<SchemaDatabase>;
const timeout = 2500;
const filepath = "schema.json";
const mainRef = "refs/heads/main";
const upstreamRef = "refs/heads/upstream";
const correctedRef = "refs/heads/corrections";
const incomingRef = "refs/heads/incoming";
const lockName = `schema-repositories:${catalogsDatabaseName}`;
let filesystem: LightningFS | undefined;
let queue: Promise<unknown> = Promise.resolve();
let initialized = false;

export type SchemaRevision = { oid: string; message: string; timestamp: number; parents: string[] };
export type SchemaBranchHistory = { branches: { name: string; oid: string }[]; revisions: SchemaRevision[]; truncated: boolean;
  current: string; incoming?: { revision: string; conflicts: SchemaConflict[] } };
type SchemaDiffCommit = Pick<SchemaRevision, "oid" | "message">;
export type SchemaRevisionDiff = { revision: SchemaDiffCommit; parents: SchemaDiffCommit[]; base: SchemaDiffCommit | null;
  changes: { path: string; kind: "added" | "removed" | "changed" }[]; truncated: boolean };

export function schemaRepositoryPath(id: string): string
{
  validateSchemaDocumentId(id);
  return `/repositories/${id}`;
}

function fs(): LightningFS { return filesystem ??= new LightningFS(catalogsDatabaseName, { defer: true }); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

async function bounded<T>(promise: Promise<T>, stage: string, cancel: () => void = () => {}): Promise<T>
{
  let timer: ReturnType<typeof setTimeout> | undefined;
  try
  {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try { cancel(); } catch { /* A completed transaction is already released. */ }
        reject(new DOMException(`${stage} did not respond within ${timeout / 1000} seconds. Close other app tabs and retry.`, "TimeoutError"));
      }, timeout);
    })]);
  }
  finally { clearTimeout(timer); }
}

async function database(): Promise<Database>
{
  let expired = false;
  let opened: Database | undefined;
  const opening = Promise.resolve().then(() => openDB<SchemaDatabase>(catalogsIndexDatabaseName, 2, {
    upgrade(database, oldVersion, _newVersion, transaction)
    {
      void transaction.done.catch(() => {});
      if (expired) { transaction.abort(); return; }
      for (const name of ["catalog", "pending", "removed", "state", "indexes", "policies"] as const)
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
      if (!oldVersion) void transaction.objectStore("state").put(false, "seeded").catch(() => {});
      // Migrate the legacy map atomically, then retire it so old clients cannot
      // authorize against a policy copy that new clients no longer maintain.
      void transaction.objectStore("state").get("vaultPolicy").then(saved => {
        for (const [id, policy] of Object.entries(policyMap(saved))) void transaction.objectStore("policies").put(policy, id);
        return transaction.objectStore("state").delete("vaultPolicy");
      }).catch(() => {});
    },
    blocking() { opened?.close(); },
  }));
  // IndexedDB open requests cannot be cancelled. Close a connection that arrives after the deadline.
  void opening.then(value => { opened = value; if (expired) value.close(); }, () => {});
  return bounded(opening, "Opening schema storage", () => { expired = true; });
}

async function transaction<Mode extends "readonly" | "readwrite", T>(database: Database, stores: StoreName[], mode: Mode,
  work: (transaction: IDBPTransaction<SchemaDatabase, StoreName[], Mode>) => Promise<T>): Promise<T>
{
  const active = database.transaction(stores, mode);
  void active.done.catch(() => {});
  try
  {
    return await bounded(Promise.all([work(active), active.done]).then(([result]) => result),
      mode === "readonly" ? "Reading schema metadata" : "Saving schema metadata", () => active.abort());
  }
  catch (error) { try { active.abort(); } catch { /* Already completed or aborted. */ } throw error; }
}

function readMetadata(database: Database, id: string): Promise<SchemaMetadata | undefined>
{
  return transaction(database, ["catalog"], "readonly", active => active.objectStore("catalog").get(id));
}

function readAlphabeticalMetadata(database: Database): Promise<SchemaMetadata[]>
{
  return transaction(database, ["catalog"], "readonly", async active => {
    const records = await active.objectStore("catalog").getAll();
    const name = (record: SchemaMetadata) => record.displayName ?? record.summary?.name ?? record.file;
    return records.sort((left, right) => name(left).localeCompare(name(right), undefined, { sensitivity: "base" })
      || left.id.localeCompare(right.id));
  });
}

async function exists(path: string): Promise<boolean>
{
  try { await fs().promises.stat(path); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}

async function mkdir(path: string): Promise<void>
{
  try { await fs().promises.mkdir(path); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
}

async function removeTree(path: string): Promise<void>
{
  if (!await exists(path)) return;
  const stat = await fs().promises.lstat(path);
  if (!stat.isDirectory()) { await fs().promises.unlink(path); return; }
  for (const child of await fs().promises.readdir(path)) await removeTree(`${path}/${child}`);
  await fs().promises.rmdir(path);
}

async function head(id: string, ref = mainRef): Promise<string | null>
{
  try { return await git.resolveRef({ fs: fs(), dir: schemaRepositoryPath(id), ref }); }
  catch (error) { if (error instanceof git.Errors.NotFoundError) return null; throw error; }
}

function validateMetadata(value: SchemaMetadata): SchemaMetadata
{
  if (!value || typeof value !== "object") throw new Error("Saved schema metadata is invalid.");
  const path = schemaRepositoryPath(value.id);
  if (value.repositoryPath !== path || typeof value.file !== "string" || !value.file.trim()
    || typeof value.enabled !== "boolean" || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt))
    throw new Error(`Saved metadata for schema ${value.id} is invalid.`);
  return value;
}

async function readRecord(metadata: SchemaMetadata): Promise<SchemaDocumentRecord>
{
  const { repositoryPath, factoryDigest, ...record } = validateMetadata(metadata);
  const revision = factoryDigest ?? metadata.revision ?? await head(record.id);
  if (!revision) throw new Error(`Schema ${record.id} has no committed revision.`);
  let size: number;
  if (factoryDigest) {
    const source = defaults?.catalogs.find(catalog => catalog.id === record.id && catalog.revision === factoryDigest);
    if (!source)
      throw new Error(`The factory schema ${record.id} is unavailable.`);
    size = source.bytes ?? Number.NaN;
  } else size = (await fs().promises.stat(`${repositoryPath}/${filepath}`)).size;
  const document = await documents.read(`${record.id}:${revision}`, size, async () => {
    if (factoryDigest) return defaults!.read(record.id); // Reviewed pack decoder verifies its digest and bounds.
    const raw = JSON.parse(await fs().promises.readFile(`${repositoryPath}/${filepath}`, "utf8"));
    return validateLibraryDocument(raw, record.id).document;
  });
  return { ...record, document };
}

export function schemaMetadataIdentity(metadata: SchemaMetadata): string {
  return `${metadata.factoryDigest ?? metadata.revision}:${metadata.adapterRevision ?? defaults?.adapterRevision ?? schemaIndexVersion}:${metadata.file}`;
}

async function discovery(database: Database, metadata: SchemaMetadata): Promise<SchemaDiscovery>
{
  const revision = metadata.factoryDigest ?? metadata.revision ?? await head(metadata.id);
  if (!revision) throw new Error(`Schema ${metadata.id} has no committed revision.`);
  const identity = schemaMetadataIdentity({ ...metadata, revision });
  const cached = await transaction(database, ["indexes"], "readonly", active => active.objectStore("indexes").get(metadata.id));
  if (cached?.identity === identity) {
    try { return validateSchemaDiscovery(cached.discovery, metadata.id, revision); }
    catch { /* An invalid derived cache is rebuilt from its authoritative source. */ }
  }
  const prepared = metadata.factoryDigest && defaults?.readIndex
    ? await defaults.readIndex(metadata.id)
    : createSchemaDiscovery(validateLibraryDocument((await readRecord(metadata)).document, metadata.id), revision);
  validateSchemaDiscovery(prepared, metadata.id, revision);
  try {
    await transaction(database, ["indexes", "catalog"], "readwrite", async active => {
      const latest = await active.objectStore("catalog").get(metadata.id);
      if (!latest || schemaMetadataIdentity({ ...latest, revision: latest.revision ?? revision }) !== identity)
        throw new Error("The schema changed while its discovery index was loading. Try again.");
      await active.objectStore("indexes").put({ identity, discovery: prepared }, metadata.id);
      await active.objectStore("catalog").put({ ...latest, revision, summary: prepared.summary }, metadata.id);
    });
  } catch (error) {
    // A derived index is optional. Full storage must not make an already saved
    // source unusable or cause a second editable content copy to be created.
    if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
    console.warn("Schema discovery could not be cached because browser storage is full.");
  }
  return prepared;
}

/** Metadata-only listing is the normal startup path, including disabled cards. */
export function listSchemaMetadata(): Promise<SchemaMetadata[]> {
  return serialized(async database => {
    const records = await readAlphabeticalMetadata(database);
    for (const record of records) {
      validateMetadata(record);
      let changed = false;
      if (!record.factoryDigest && !record.revision) {
        const revision = await head(record.id);
        if (!revision) throw new Error(`Schema ${record.id} has no committed revision.`);
        record.revision = revision;
        changed = true;
      }
      if (defaults?.adapterRevision && record.adapterRevision !== defaults.adapterRevision) {
        record.adapterRevision = defaults.adapterRevision;
        delete record.summary;
        changed = true;
      }
      if (changed) await transaction(database, ["catalog"], "readwrite", async active => { await active.objectStore("catalog").put(record, record.id); });
    }
    return records;
  });
}

export function readSchemaDiscovery(id: string): Promise<SchemaDiscovery> {
  validateSchemaDocumentId(id);
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata || !metadata.enabled) throw new Error("This schema is not enabled.");
    return discovery(database, metadata);
  });
}

async function materializedRecord(database: Database, metadata: SchemaMetadata): Promise<SchemaDocumentRecord> {
  const record = await readRecord(metadata);
  if (metadata.factoryDigest && (metadata.historyDigest !== metadata.factoryDigest || !metadata.upstreamRevision))
    return writeFactoryRecord(database, record, metadata);
  return record;
}

export function readSchemaDocument(id: string, expectedIdentity?: string): Promise<SchemaDocumentRecord> {
  validateSchemaDocumentId(id);
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema is no longer available. Reload the schema list and try again.");
    if (expectedIdentity && schemaMetadataIdentity(metadata) !== expectedIdentity)
      throw new Error("The schema changed while its document was loading. Try again.");
    return materializedRecord(database, metadata);
  });
}

export function releaseSchemaDocument(id: string): void { documents.invalidate(`${id}:`); }

/** Only this worker-owned path can publish policy for a freshly hydrated model. */
export function readSchemaOperation(operationId: string, expectedIdentity: string): Promise<OperationModel> {
  const id = operationId.slice(0, operationId.indexOf(":"));
  return readSchemaOperations(id, expectedIdentity, [operationId]).then(models => models[0]!);
}

/** Bound temporary models and publish policies once, only after the whole batch succeeds. */
export function readSchemaOperations(id: string, expectedIdentity: string, operationIds: string[]): Promise<OperationModel[]> {
  validateSchemaDocumentId(id);
  const ids = [...new Set(operationIds)];
  if (!ids.length || ids.length > schemaModelBatchSize || ids.some(operationId => !operationId.startsWith(`${id}:`)))
    throw new Error("An operation batch must contain 1 to 16 operations from the same schema.");
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata?.enabled || schemaMetadataIdentity(metadata) !== expectedIdentity)
      throw new Error("The schema changed while its operation was loading. Try again.");
    const record = await materializedRecord(database, metadata);
    const descriptors = new Map((await discovery(database, metadata)).operations.map(operation => [operation.id, operation]));
    const inspect = defaults?.catalogs.some(catalog => catalog.id === id) && defaults.inspectOperation;
    const canonical = inspect ? undefined : new Map(validateLibraryDocument(record.document, id).operations.map(operation => [operation.id, operation]));
    const models: OperationModel[] = [];
    const approved = new Set<string>();
    for (const operationId of ids) {
      const descriptor = descriptors.get(operationId);
      if (!descriptor) throw new Error("This operation is not available in the registered schemas.");
      const operation = inspect ? inspect(record.document, id, descriptor) : canonical!.get(operationId);
      if (!operation) throw new Error("This operation is not available in the registered schemas.");
      if (operation.unavailableReason) throw new Error(operation.unavailableReason);
      const origin = operationServerUrl(record.document, operation);
      const { schema } = scopeOperationSchema(record.document, operation.path, operation.method, true);
      try { approved.add((await approvedOperation(operation, origin)).fingerprint); }
      catch (error) { if (!(error instanceof VaultError) || error.code !== "PERMISSION") throw error; }
      models.push({ operation, document: schema, origin, sourceIdentity: expectedIdentity,
        bytes: new TextEncoder().encode(JSON.stringify([operation, schema])).byteLength });
    }
    const revision = metadata.factoryDigest ?? metadata.revision!;
    if (approved.size) await transaction(database, ["policies"], "readwrite", async active => {
      const previous = await active.objectStore("policies").get(id);
      const fingerprints = previous?.version === 2 && previous.revision === revision
        && previous.adapterRevision === metadata.adapterRevision && Array.isArray(previous.fingerprints)
        ? previous.fingerprints : [];
      const merged = [...new Set([...fingerprints, ...approved])];
      if (merged.length !== fingerprints.length) await active.objectStore("policies").put({ revision, version: 2,
        ...(metadata.adapterRevision ? { adapterRevision: metadata.adapterRevision } : {}), fingerprints: merged }, id);
    });
    return models;
  });
}

async function versionText(id: string, oid: string): Promise<string>
{
  const { blob } = await git.readBlob({ fs: fs(), dir: schemaRepositoryPath(id), oid, filepath });
  return new TextDecoder().decode(blob);
}

function policyMap(value: SchemaDatabase["state"]["value"] | undefined): SchemaCredentialPolicies
{
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function credentialPolicy(record: SchemaDocumentRecord, revision: string): Promise<SchemaCredentialPolicies[string]>
{
  const adapter = defaults?.adapterRevision ? { adapterRevision: defaults.adapterRevision } : {};
  if (!record.enabled) return { revision, fingerprints: [], version: 2, ...adapter };
  const validated = validateLibraryDocument(record.document, record.id);
  const fingerprints: string[] = [];
  if (record.enabled)
    for (const operation of validated.operations)
    {
      if (operation.unavailableReason) continue;
      try { fingerprints.push((await approvedOperation(operation, operationServerUrl(validated.document, operation))).fingerprint); }
      catch (error)
      {
        // A schema may describe destinations unavailable to credential execution,
        // such as public HTTP. Keeping it importable grants no credential access.
        if (!(error instanceof VaultError) || error.code !== "PERMISSION") throw error;
      }
    }
  return { revision, fingerprints, version: 2, ...adapter };
}

async function storeCredentialPolicy(active: IDBPTransaction<SchemaDatabase, StoreName[], "readwrite">,
  id: string, policy: SchemaCredentialPolicies[string] | undefined): Promise<void>
{
  if (policy) await active.objectStore("policies").put(policy, id);
  else await active.objectStore("policies").delete(id);
}

/** Upgrade existing catalogs under their repository lock before they are published. */
async function backfillCredentialPolicies(database: Database): Promise<void>
{
  const records = await transaction(database, ["catalog"], "readonly", active => active.objectStore("catalog").getAll());
  for (const metadata of records)
  {
    const revision = metadata.factoryDigest ?? await head(metadata.id);
    if (!revision) throw new Error(`Schema ${metadata.id} has no committed revision for credential policy.`);
    const existing = await transaction(database, ["policies"], "readonly", active => active.objectStore("policies").get(metadata.id));
    if (existing?.version === 2 && existing.revision === revision && Array.isArray(existing.fingerprints) && (metadata.enabled || !existing.fingerprints.length))
      continue;
    else
    {
      const policy = metadata.enabled ? await credentialPolicy(await readRecord(metadata), revision)
        : { revision, fingerprints: [], version: 2 as const };
      await transaction(database, ["policies"], "readwrite", active => storeCredentialPolicy(active, metadata.id, policy));
    }
  }
}

async function finishPending(database: Database, pending: PendingSchema): Promise<void>
{
  const metadata = validateMetadata(pending.metadata);
  const id = metadata.id;
  const current = await head(id);
  if (current !== pending.previousRevision && current !== pending.revision)
    throw new Error(`Schema ${id} changed while a previous save was unfinished. Its repository has been preserved.`);
  for (const update of pending.refs ?? []) {
    if (![upstreamRef, correctedRef, incomingRef].includes(update.ref)) throw new Error("An unfinished schema branch is invalid.");
    const current = await head(id, update.ref);
    if (current !== update.previousRevision && current !== update.revision)
      throw new Error(`Schema ${id} has an independently changed branch. Its repository has been preserved.`);
  }
  const text = await versionText(id, pending.revision);
  const raw = JSON.parse(text) as Record<string, unknown>;
  let document: Record<string, unknown>;
  let policy: SchemaCredentialPolicies[string];
  if (metadata.factoryDigest) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(raw))));
    if (Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("") !== metadata.factoryDigest)
      throw new Error(`The factory history for ${id} does not match its source digest.`);
    document = raw;
    const previous = await transaction(database, ["policies"], "readonly", active => active.objectStore("policies").get(id));
    policy = previous?.revision === metadata.factoryDigest && previous.adapterRevision === metadata.adapterRevision
      ? previous : { revision: metadata.factoryDigest, fingerprints: [], version: 2,
        ...(metadata.adapterRevision ? { adapterRevision: metadata.adapterRevision } : {}) };
  } else {
    const inspected = validateLibraryDocument(raw, id);
    document = inspected.document;
    metadata.summary = createSchemaSummary(inspected);
    policy = await credentialPolicy({ ...metadata, document }, pending.revision);
  }
  metadata.gitRevision = pending.revision;
  metadata.revision = metadata.factoryDigest ?? pending.revision;
  const dir = metadata.repositoryPath;
  await fs().promises.writeFile(`${dir}/${filepath}`, text, "utf8");
  await git.add({ fs: fs(), dir, filepath });
  await fs().promises.flush();
  await git.writeRef({ fs: fs(), dir, ref: mainRef, value: pending.revision, force: true });
  for (const update of pending.refs ?? []) {
    if (update.revision) await git.writeRef({ fs: fs(), dir, ref: update.ref, value: update.revision, force: true });
    else if (await head(id, update.ref)) await git.deleteRef({ fs: fs(), dir, ref: update.ref });
  }
  await fs().promises.flush();
  await transaction(database, ["catalog", "pending", "policies", "indexes"], "readwrite", async active => {
    await active.objectStore("catalog").put(metadata, id);
    await active.objectStore("indexes").delete(id);
    await storeCredentialPolicy(active, id, policy);
    await active.objectStore("pending").delete(id);
  });
}

async function recover(database: Database): Promise<void>
{
  const [removed, pending] = await transaction(database, ["removed", "pending"], "readonly", active => Promise.all([
    active.objectStore("removed").getAllKeys(), active.objectStore("pending").getAll(),
  ]));
  for (const id of removed)
  {
    await removeTree(schemaRepositoryPath(id));
    await fs().promises.flush();
    await transaction(database, ["removed"], "readwrite", async active => { await active.objectStore("removed").delete(id); });
  }
  for (const entry of pending) if (!removed.includes(entry.metadata.id)) await finishPending(database, entry);
}

async function commitSnapshot(id: string, document: Record<string, unknown>, message: string, parents: string[]): Promise<string> {
  const dir = schemaRepositoryPath(id);
  await mkdir("/repositories");
  await mkdir(dir);
  if (!await exists(`${dir}/.git/HEAD`)) await git.init({ fs: fs(), dir, defaultBranch: "main" });
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const blob = await git.writeBlob({ fs: fs(), dir, blob: new TextEncoder().encode(text) });
  const tree = await git.writeTree({ fs: fs(), dir, tree: [{ mode: "100644", path: filepath, oid: blob, type: "blob" }] });
  const author = { name: "Local schema manager", email: "schema@localhost", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
  return git.writeCommit({ fs: fs(), dir, commit: { tree, parent: [...new Set(parents)], author, committer: author, message: `${message}\n` } });
}

async function refUpdate(id: string, ref: string, revision: string | null): Promise<RefUpdate> {
  return { ref, revision, previousRevision: await head(id, ref) };
}

async function correctedSnapshot(id: string, upstream: string, document: Record<string, unknown>, patches: SchemaPatch[], previous?: string,
  raw?: Record<string, unknown>): Promise<string> {
  if (!patches.length) return upstream;
  raw ??= JSON.parse(await versionText(id, upstream));
  if (previous === upstream) previous = undefined;
  if (sameSchemaValue(raw, document) && !previous) return upstream;
  const label = sameSchemaValue(raw, document) ? "Upstream already includes schema corrections"
    : `Apply schema corrections: ${patches.map(schemaPatchName).join(", ")}`;
  return commitSnapshot(id, document, label, [upstream, ...(previous ? [previous] : [])]);
}

/** Materialize source and reviewed corrections lazily in the existing per-schema Git repository. */
async function writeFactoryRecord(database: Database, record: SchemaDocumentRecord, metadata: SchemaMetadata): Promise<SchemaDocumentRecord> {
  const patches = defaults?.catalogs.find(catalog => catalog.id === record.id)?.patches ?? [];
  const raw = patches.length && defaults?.readUpstream ? await defaults.readUpstream(record.id) : record.document;
  const previous = metadata.upstreamRevision ?? await head(record.id);
  const same = previous && sameSchemaValue(JSON.parse(await versionText(record.id, previous)), raw);
  const upstream = same ? previous : await commitSnapshot(record.id, raw,
    `${previous ? "Update" : "Import"} published schema: ${record.displayName ?? (raw.info as { title: string }).title}`, previous ? [previous] : []);
  const corrected = await correctedSnapshot(record.id, upstream, record.document, patches, metadata.correctedRevision, raw);
  return writeRecord(database, record, undefined, metadata.factoryDigest, { revision: corrected,
    branches: { upstreamRevision: upstream, correctedRevision: corrected, patches },
    refs: [await refUpdate(record.id, upstreamRef, upstream), await refUpdate(record.id, correctedRef, corrected)] });
}

async function writeRecord(database: Database, record: SchemaDocumentRecord, commitMessage?: string, factoryDigest?: string,
  options: { revision?: string; parents?: string[]; forceCommit?: boolean; branches?: SchemaBranches; clearIncoming?: boolean; refs?: RefUpdate[] } = {}): Promise<SchemaDocumentRecord>
{
  const existing = await readMetadata(database, record.id);
  const previousRevision = await head(record.id);
  const dir = schemaRepositoryPath(record.id);
  const { document, ...details } = record;
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const unchanged = existing && previousRevision && await versionText(record.id, previousRevision) === text;
  const metadata = validateMetadata({ ...details, createdAt: existing?.createdAt ?? record.createdAt,
    enabled: existing?.enabled ?? record.enabled, repositoryPath: dir,
    ...(existing?.upstreamRevision ? { upstreamRevision: existing.upstreamRevision, correctedRevision: existing.correctedRevision, patches: existing.patches } : {}),
    ...(existing?.incoming ? { incoming: existing.incoming } : {}), ...options.branches,
    ...(defaults?.adapterRevision ? { adapterRevision: defaults.adapterRevision } : {}),
    ...(factoryDigest ? { factoryDigest, historyDigest: factoryDigest } : {}) });
  if (!factoryDigest) { delete metadata.factoryDigest; delete metadata.historyDigest; }
  if (options.clearIncoming) delete metadata.incoming;
  // Metadata (including enablement) is deliberately outside Git. Identical documents add no revision.
  if (unchanged && !options.refs?.length && !options.revision && !options.forceCommit)
  {
    metadata.revision = factoryDigest ?? previousRevision;
    metadata.gitRevision = previousRevision;
    const policy = await credentialPolicy({ ...record, enabled: metadata.enabled }, metadata.revision);
    await transaction(database, ["catalog", "policies"], "readwrite", async active => {
      await active.objectStore("catalog").put(metadata, record.id);
      await storeCredentialPolicy(active, record.id, policy);
    });
    return { ...record, enabled: metadata.enabled };
  }
  // Construct an immutable commit before replacing the authoritative working file.
  // The journal contains only metadata and OIDs, never a second copy of the schema.
  const info = document.info as { title: string; version: string };
  const label = `${info.title} (v${info.version})`.replace(/\s+/g, " ").trim();
  const revision = options.revision ?? (unchanged && !options.forceCommit ? previousRevision : await commitSnapshot(record.id, document,
    commitMessage ?? `${previousRevision ? "Replace" : "Import"} OpenAPI schema: ${label}`, options.parents ?? (previousRevision ? [previousRevision] : [])))!;
  const refs = options.refs ?? [];
  if (!metadata.upstreamRevision) {
    metadata.upstreamRevision = revision;
    metadata.correctedRevision = revision;
    refs.push(await refUpdate(record.id, upstreamRef, revision), await refUpdate(record.id, correctedRef, revision));
  }
  await fs().promises.flush();
  const pending = { metadata, revision, previousRevision, refs };
  await transaction(database, ["pending"], "readwrite", async active => { await active.objectStore("pending").put(pending, record.id); });
  await finishPending(database, pending);
  if (!factoryDigest) documents.invalidate(`${record.id}:`);
  return readRecord(metadata);
}

async function updateBundledExamples(database: Database): Promise<void>
{
  const hash = async (value: unknown) => (await git.hashBlob({ object: `${JSON.stringify(value, null, 2)}\n` })).oid;
  const current = await (currentExampleRevisions ??= Promise.all(bundledCatalogs.map(async catalog =>
    `${catalog.id}:${await hash(catalog.document)}:${await hash(catalog.groups)}`)));
  const previous = await transaction(database, ["state"], "readonly", active => active.objectStore("state").get("exampleRevisions"));
  if (JSON.stringify(previous) === JSON.stringify(current)) return;
  const installed = Array.isArray(previous) ? previous : [];
  for (const [index, catalog] of bundledCatalogs.entries()) {
    const metadata = await readMetadata(database, catalog.id);
    if (!metadata || metadata.factoryDigest) continue;
    const revision = await head(catalog.id);
    if (!revision) continue;
    // Identify stock copies from their Git tree without decoding saved documents.
    const { tree } = await git.readTree({ fs: fs(), dir: schemaRepositoryPath(catalog.id), oid: revision });
    const source = tree.find(entry => entry.path === filepath && entry.type === "blob");
    const [, target, targetGroups] = current[index]!.split(":");
    if (!source) continue;
    const known = legacyExamples.filter(example => example.id === catalog.id);
    for (const entry of installed) {
      if (typeof entry !== "string") continue;
      const [id, document, groups] = entry.split(":");
      if (id === catalog.id && /^[a-f0-9]{40}$/.test(document ?? "") && /^[a-f0-9]{40}$/.test(groups ?? ""))
        known.push({ id, document: document!, groups: groups!, sourceCommit: "previous installation" });
    }
    if (source.oid !== target && !known.some(example => example.document === source.oid)) continue;
    const groups = metadata.groups ? await hash(metadata.groups) : undefined;
    const bundledGroups = !groups || groups === targetGroups || known.some(example => example.document === source.oid && example.groups === groups);
    if (source.oid === target && (!bundledGroups || groups === targetGroups)) continue;
    const { document } = validateSchemaDocument(catalog.document, catalog.id);
    await writeRecord(database, { ...metadata, document,
      ...(bundledGroups ? { groups: catalog.groups } : {}), updatedAt: Date.now() },
      `Update bundled OpenAPI example: ${catalog.name}`);
  }
  await transaction(database, ["state"], "readwrite", async active => {
    await active.objectStore("state").put(current, "exampleRevisions");
  });
}

async function initialize(database: Database): Promise<void>
{
  const seeded = await transaction(database, ["state"], "readonly", active => active.objectStore("state").get("seeded"));
  const now = Date.now();
  if (!seeded) {
    // The marker survives deleting every example; interrupted seeds can resume.
    for (const catalog of bundledCatalogs) {
      if (await readMetadata(database, catalog.id)) continue;
      const { document } = validateSchemaDocument(catalog.document, catalog.id);
      await writeRecord(database, { id: catalog.id, file: catalog.file, document, enabled: true,
        groups: catalog.groups, createdAt: now, updatedAt: now });
    }
    await transaction(database, ["state"], "readwrite", async active => { await active.objectStore("state").put(true, "seeded"); });
  }
  await updateBundledExamples(database);
  if (defaults) await transaction(database, ["catalog", "state"], "readwrite", async active => {
    const store = active.objectStore("state");
    const previous = await store.get("serviceDefaults");
    const installed = new Set(Array.isArray(previous) ? previous : []);
    const records = new Map((await active.objectStore("catalog").getAll()).map(record => [record.id, record]));
    for (const catalog of defaults!.catalogs) {
      const existing = records.get(catalog.id);
      if (!installed.has(catalog.id) && !existing) {
        await active.objectStore("catalog").put({ id: catalog.id, file: catalog.file, displayName: catalog.name,
          repositoryPath: schemaRepositoryPath(catalog.id), factoryDigest: catalog.revision,
          ...(catalog.patches?.length ? { patches: catalog.patches } : {}),
          revision: catalog.revision, ...(catalog.summary ? { summary: catalog.summary } : {}),
          ...(defaults!.adapterRevision ? { adapterRevision: defaults!.adapterRevision } : {}),
          enabled: catalog.enabled ?? true, createdAt: now, updatedAt: now }, catalog.id);
      } else if (existing?.factoryDigest) {
        // Unmodified factory copies follow bundled updates; authored Git copies do not.
        const sourceChanged = existing.factoryDigest !== catalog.revision || existing.adapterRevision !== defaults!.adapterRevision;
        if (sourceChanged || existing.displayName !== catalog.name) {
          if (sourceChanged) documents.invalidate(`${catalog.id}:`);
          await active.objectStore("catalog").put({ ...existing, displayName: catalog.name,
            factoryDigest: catalog.revision, revision: catalog.revision,
            ...(catalog.patches?.length ? { patches: catalog.patches } : {}),
            ...(catalog.summary ? { summary: catalog.summary } : {}),
            ...(defaults!.adapterRevision ? { adapterRevision: defaults!.adapterRevision } : {}), updatedAt: now }, catalog.id);
        }
      }
      installed.add(catalog.id);
    }
    await store.put([...installed], "serviceDefaults");
  });
}

function serialized<T>(task: (database: Database) => Promise<T>): Promise<T>
{
  const pending = queue.catch(() => {}).then(async () => {
    if (!globalThis.navigator?.locks) throw new Error("This browser does not support the locks required to save schema repositories safely.");
    const controller = new AbortController();
    let started = false;
    const waiting = navigator.locks.request(lockName, { signal: controller.signal }, async () => {
      started = true;
      const connection = await database();
      try {
        await recover(connection);
        if (!initialized) { await initialize(connection); initialized = true; }
        return await task(connection);
      }
      finally { connection.close(); }
    });
    // Only bound lock acquisition. Once work begins, retain its lock until every filesystem write settles.
    const timer = setTimeout(() => { if (!started) controller.abort(new DOMException("Schema storage is busy in another tab. Retry after its save finishes.", "TimeoutError")); }, timeout);
    try { return await waiting; }
    finally { clearTimeout(timer); }
  });
  queue = pending;
  return pending.catch(error => { throw new Error(`Could not access saved schema repositories: ${message(error)}`, { cause: error }); });
}

/** Fresh browsers seed once; subsequent refreshes only read existing metadata and working files. */
export function loadSchemaDocuments(): Promise<SchemaDocumentRecord[]>
{
  return serialized(async database => {
    await backfillCredentialPolicies(database);
    const records = await readAlphabeticalMetadata(database);
    const loaded: SchemaDocumentRecord[] = [];
    for (const record of records) loaded.push(await readRecord(record));
    return loaded;
  });
}

export function putSchemaDocument(value: SchemaDocumentRecord): Promise<SchemaDocumentRecord>
{
  // Snapshot before queuing, so callers cannot mutate an in-flight import.
  const record = structuredClone(value);
  record.document = validateLibraryDocument(record.document, record.id).document;
  validateMetadata({ ...record, repositoryPath: schemaRepositoryPath(record.id) });
  return serialized(database => writeRecord(database, record));
}

async function branchBase(metadata: SchemaMetadata): Promise<{ upstream: string; corrected: string; current: string }> {
  const current = await head(metadata.id);
  if (!current) throw new Error("This schema has no working revision.");
  // Old authored repositories had only main. Their oldest import is the safe
  // merge baseline; later edits are preserved, never guessed to be upstream.
  const oldest = metadata.upstreamRevision ? undefined : (await git.log({ fs: fs(), dir: metadata.repositoryPath, ref: mainRef })).at(-1)!.oid;
  const upstream = metadata.upstreamRevision ?? oldest!;
  return { upstream, corrected: metadata.correctedRevision ?? upstream, current };
}

async function publishUpstream(database: Database, metadata: SchemaMetadata, record: SchemaDocumentRecord,
  incoming: IncomingSchema, document: Record<string, unknown>, current: string): Promise<SchemaDocumentRecord> {
  const { groups: _groups, displayName: _displayName, ...authored } = record;
  validateLibraryDocument(document, record.id);
  const joinsNewAncestry = current !== incoming.corrected && !await git.isDescendent({ fs: fs(), dir: metadata.repositoryPath,
    oid: current, ancestor: incoming.corrected, depth: -1 });
  return writeRecord(database, { ...authored, document, file: incoming.file, updatedAt: Date.now() },
    "Merge published schema and replay local changes", undefined, {
      parents: [...new Set([current, incoming.corrected])],
      forceCommit: joinsNewAncestry,
      branches: { upstreamRevision: incoming.upstream, correctedRevision: incoming.corrected, patches: incoming.patches },
      clearIncoming: true,
      refs: [await refUpdate(metadata.id, upstreamRef, incoming.upstream),
        await refUpdate(metadata.id, correctedRef, incoming.corrected), await refUpdate(metadata.id, incomingRef, null)],
    });
}

/** A new published snapshot is merged with corrections and authored edits, never blindly substituted. */
export function updateSchemaUpstream(id: string, value: Record<string, unknown>, file: string): Promise<void> {
  validateSchemaDocumentId(id);
  const incomingDocument = structuredClone(value);
  validateLibraryDocument(incomingDocument, id);
  if (typeof file !== "string" || !file.trim()) throw new Error("The incoming schema needs a filename.");
  return serialized(database => updateUpstream(database, id, incomingDocument, file));
}

/** Use the bundled source without fetching a remote schema or discarding authored edits. */
export function updateSchemaFromBundle(id: string): Promise<void> {
  validateSchemaDocumentId(id);
  return serialized(async database => {
    const source = defaults?.catalogs.find(source => source.id === id);
    if (!source) throw new Error("There is no bundled revision for this schema.");
    const metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    // An unedited factory copy already follows this bundle. Taking the authored
    // merge path would discard its catalogue label and automatic update ownership.
    if (metadata.factoryDigest === source.revision && metadata.file === source.file && !metadata.incoming
      && sameSchemaValue(metadata.patches ?? [], source.patches ?? [])) return;
    const document = defaults!.readUpstream ? await defaults!.readUpstream(id) : await defaults!.read(id);
    await updateUpstream(database, id, document, source.file, source.patches ?? []);
  });
}

async function updateUpstream(database: Database, id: string, incomingDocument: Record<string, unknown>, file: string,
  reviewedPatches?: SchemaPatch[]): Promise<void> {
    validateLibraryDocument(incomingDocument, id);
    let metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    const record = await materializedRecord(database, metadata);
    metadata = (await readMetadata(database, id))!;
    const previous = await branchBase(metadata);
    const patches = reviewedPatches ?? metadata.patches ?? [];
    const correctedDocument = applySchemaPatches(incomingDocument, patches);
    validateLibraryDocument(correctedDocument, id);
    const upstream = sameSchemaValue(JSON.parse(await versionText(id, previous.upstream)), incomingDocument) ? previous.upstream
      : await commitSnapshot(id, incomingDocument, `Update published schema: ${file}`, [previous.upstream]);
    const corrected = upstream === previous.upstream && sameSchemaValue(JSON.parse(await versionText(id, previous.corrected)), correctedDocument) ? previous.corrected
      : await correctedSnapshot(id, upstream, correctedDocument, patches, previous.corrected, incomingDocument);
    // The working copy may contain local edits. Reapplying its existing source
    // is still a no-op, unless a pending proposal or source metadata must change.
    if (!metadata.incoming && upstream === previous.upstream && corrected === previous.corrected
      && file === metadata.file && sameSchemaValue(patches, metadata.patches ?? [])) return;
    const incoming: IncomingSchema = { base: previous.corrected, upstream, corrected, file, patches };
    const base = JSON.parse(await versionText(id, previous.corrected));
    const merged = mergeSchemaDocuments(base, record.document, correctedDocument);
    if (merged.conflicts.length) {
      // Publish the review branch and its metadata through the same recovery
      // journal as ordinary saves. The usable main and its authority stay intact.
      await writeRecord(database, record, undefined, metadata.factoryDigest, {
        revision: previous.current, branches: { incoming }, refs: [await refUpdate(id, incomingRef, corrected)],
      });
    } else await publishUpstream(database, metadata, record, incoming, merged.document, previous.current);
}

/** Resolution is bound to both reviewed tips; concurrent edits cannot consume stale decisions. */
export function resolveSchemaUpdate(id: string, current: string, incomingRevision: string, resolutions: Record<string, SchemaResolution>): Promise<void> {
  validateSchemaDocumentId(id);
  const choices = structuredClone(resolutions);
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata?.incoming || metadata.incoming.corrected !== incomingRevision || await head(id) !== current)
      throw new Error("The schema changed while its conflicts were being reviewed. Reload history and review again.");
    const record = await readRecord(metadata);
    const incoming = metadata.incoming;
    const base = JSON.parse(await versionText(id, incoming.base));
    const proposed = JSON.parse(await versionText(id, incoming.corrected));
    const conflicts = mergeSchemaDocuments(base, record.document, proposed).conflicts;
    if (!objectChoices(choices) || Object.keys(choices).length !== conflicts.length
      || conflicts.some(conflict => !Object.hasOwn(choices, conflict.path)))
      throw new Error("Choose the current or incoming value for every schema conflict.");
    const merged = mergeSchemaDocuments(base, record.document, proposed, choices);
    if (merged.conflicts.length) throw new Error("Some schema conflicts still need a decision.");
    await publishUpstream(database, metadata, record, incoming, merged.document, current);
  });
}

function objectChoices(value: unknown): value is Record<string, SchemaResolution> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every(choice => choice === "current" || choice === "incoming");
}

export function dismissSchemaUpdate(id: string, current: string, incomingRevision: string): Promise<void> {
  validateSchemaDocumentId(id);
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata?.incoming || metadata.incoming.corrected !== incomingRevision || await head(id) !== current)
      throw new Error("The schema changed while its update was being reviewed. Reload history and review again.");
    await writeRecord(database, await readRecord(metadata), undefined, metadata.factoryDigest,
      { revision: current, clearIncoming: true, refs: [await refUpdate(id, incomingRef, null)] });
  });
}

/** Rename the latest working document under its repository lock, preserving unrelated edits. */
export function renameSchemaDocument(id: string, name: string): Promise<SchemaDocumentRecord>
{
  validateSchemaDocumentId(id);
  const title = typeof name === "string" ? name.trim() : "";
  if (!title) throw new Error("Enter a schema name.");
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    const record = await materializedRecord(database, metadata);
    const info = record.document.info as { title: string; version: string };
    if ((record.displayName ?? info.title) === title) return record;
    const document = { ...record.document, info: { ...info, title } };
    validateLibraryDocument(document, id);
    const label = (value: string) => value.replace(/\s+/g, " ");
    const { displayName: _displayName, ...authored } = record;
    return writeRecord(database, { ...authored, document, updatedAt: Date.now() },
      `Rename OpenAPI schema: ${label(info.title)} → ${label(title)}`);
  });
}

/** Toggle current metadata without writing a caller's potentially stale document snapshot. */
export function setSchemaDocumentEnabled(id: string, enabled: boolean, options: { metadataOnly: true }): Promise<SchemaMetadata>;
export function setSchemaDocumentEnabled(id: string, enabled: boolean, options?: { metadataOnly?: false }): Promise<SchemaDocumentRecord>;
export function setSchemaDocumentEnabled(id: string, enabled: boolean, options: { metadataOnly?: boolean } = {}): Promise<SchemaDocumentRecord | SchemaMetadata>
{
  validateSchemaDocumentId(id);
  if (typeof enabled !== "boolean") throw new Error("Schema enablement must be Boolean.");
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    const revision = metadata.factoryDigest ?? metadata.revision ?? await head(id);
    if (!revision) throw new Error(`Schema ${id} has no committed revision for credential policy.`);
    const prepared = enabled && options.metadataOnly ? await discovery(database, metadata) : undefined;
    const record = options.metadataOnly ? undefined : await readRecord(metadata);
    const previous = await transaction(database, ["policies"], "readonly", active => active.objectStore("policies").get(id));
    const policy = enabled && record ? await credentialPolicy({ ...record, enabled }, revision)
      : enabled && previous?.revision === revision && previous.adapterRevision === metadata.adapterRevision ? previous
      : { revision, fingerprints: [], version: 2 as const, ...(metadata.adapterRevision ? { adapterRevision: metadata.adapterRevision } : {}) };
    const next = { ...metadata, enabled, revision, ...(prepared ? { summary: prepared.summary } : {}) };
    await transaction(database, ["catalog", "policies"], "readwrite", async active => {
      await active.objectStore("catalog").put(next, id);
      await storeCredentialPolicy(active, id, policy);
    });
    if (!enabled) documents.invalidate(`${id}:`);
    return options.metadataOnly ? next : { ...record!, enabled };
  });
}

export function deleteSchemaDocument(id: string): Promise<void>
{
  const path = schemaRepositoryPath(id);
  return serialized(async database => {
    await transaction(database, ["catalog", "pending", "removed", "policies", "indexes"], "readwrite", async active => {
      const metadata = await active.objectStore("catalog").get(id);
      if (!metadata) throw new Error("This schema could not be found in this browser.");
      const reason = schemaDeletionReason({ bundled: isBundledSchema(id), enabled: metadata.enabled });
      if (reason) throw new Error(reason);
      await active.objectStore("removed").put(true, id);
      await active.objectStore("catalog").delete(id);
      await active.objectStore("pending").delete(id);
      await active.objectStore("indexes").delete(id);
      await storeCredentialPolicy(active, id, undefined);
    });
    documents.invalidate(`${id}:`);
    await removeTree(path);
    await fs().promises.flush();
    await transaction(database, ["removed"], "readwrite", async active => { await active.objectStore("removed").delete(id); });
  });
}

export function getSchemaHistory(id: string): Promise<SchemaRevision[]>
{
  schemaRepositoryPath(id);
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    if (metadata.factoryDigest) await materializedRecord(database, metadata);
    return (await git.log({ fs: fs(), dir: schemaRepositoryPath(id), ref: mainRef })).map(({ oid, commit }) => ({
      oid, message: commit.message.trim(), timestamp: commit.committer.timestamp * 1000, parents: commit.parent,
    }));
  });
}

/** Branch metadata and commit ancestry only; source/diff blobs are read on selection. */
export function getSchemaBranchHistory(id: string, limit = 100): Promise<SchemaBranchHistory> {
  schemaRepositoryPath(id);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Schema history is limited to 1–1000 commits.");
  return serialized(async database => {
    let metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    if (metadata.factoryDigest && (metadata.historyDigest !== metadata.factoryDigest || !metadata.upstreamRevision))
      await materializedRecord(database, metadata);
    metadata = (await readMetadata(database, id))!;
    const branches: SchemaBranchHistory["branches"] = [];
    for (const [ref, name] of [[mainRef, "Working"], [upstreamRef, "Published"], [correctedRef, "Corrections"], [incomingRef, "Incoming"]]) {
      const oid = await head(id, ref!);
      if (oid) branches.push({ name: name!, oid });
    }
    const commits = new Map<string, SchemaRevision>();
    const queue = branches.map(branch => branch.oid);
    while (queue.length && commits.size < limit) {
      const oid = queue.shift()!;
      if (commits.has(oid)) continue;
      const { commit } = await git.readCommit({ fs: fs(), dir: metadata.repositoryPath, oid });
      commits.set(oid, { oid, message: commit.message.trim(), timestamp: commit.committer.timestamp * 1000, parents: commit.parent });
      queue.push(...commit.parent);
    }
    // Timestamps can tie or move backwards. Topology, not date, orders the graph.
    const children = new Map([...commits.keys()].map(oid => [oid, 0]));
    for (const commit of commits.values()) for (const parent of commit.parents)
      if (children.has(parent)) children.set(parent, children.get(parent)! + 1);
    const revisions: SchemaRevision[] = [];
    const ready = [...commits.values()].filter(commit => !children.get(commit.oid));
    while (ready.length) {
      ready.sort((left, right) => right.timestamp - left.timestamp || left.oid.localeCompare(right.oid));
      const commit = ready.shift()!;
      revisions.push(commit);
      for (const parent of commit.parents) if (children.has(parent)) {
        children.set(parent, children.get(parent)! - 1);
        if (!children.get(parent)) ready.push(commits.get(parent)!);
      }
    }
    let incoming: SchemaBranchHistory["incoming"];
    if (metadata.incoming) {
      const pending = metadata.incoming;
      incoming = { revision: pending.corrected, conflicts: mergeSchemaDocuments(
        JSON.parse(await versionText(id, pending.base)), (await readRecord(metadata)).document,
        JSON.parse(await versionText(id, pending.corrected))).conflicts };
    }
    return { branches, revisions, current: (await head(id))!, truncated: queue.some(oid => !commits.has(oid)), ...(incoming ? { incoming } : {}) };
  });
}

async function schemaComparison(id: string, oid: string, baseOid?: string) {
  const dir = schemaRepositoryPath(id);
  if (!/^[a-f0-9]{40}$/.test(oid) || (baseOid !== undefined && !/^[a-f0-9]{40}$/.test(baseOid)))
    throw new Error("Choose saved commits from this schema.");
  const { commit } = await git.readCommit({ fs: fs(), dir, oid });
  const parents = await Promise.all(commit.parent.map(async oid => ({ oid,
    message: (await git.readCommit({ fs: fs(), dir, oid })).commit.message.trim() })));
  const comparison = baseOid ?? commit.parent[0];
  const base = comparison ? { oid: comparison, message: (await git.readCommit({ fs: fs(), dir, oid: comparison })).commit.message.trim() } : null;
  const before = base ? JSON.parse(await versionText(id, base.oid)) : {};
  const after = JSON.parse(await versionText(id, oid));
  return { revision: { oid, message: commit.message.trim() }, parents, base, before, after };
}

/** Any two commits in this schema's isolated repository; inspection never checks out. */
export function getSchemaRevisionDiff(id: string, oid: string, limit = 200, baseOid?: string): Promise<SchemaRevisionDiff> {
  schemaRepositoryPath(id);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Choose a valid bounded schema revision.");
  return serialized(async database => {
    if (!await readMetadata(database, id)) throw new Error("This schema could not be found in this browser.");
    const { before, after, ...commits } = await schemaComparison(id, oid, baseOid);
    const diff = schemaChanges(before, after, limit);
    return { ...commits, truncated: diff.truncated, changes: diff.changes.map(({ path, kind }) => ({ path, kind })) };
  });
}

/** Expanded fields alone request bounded real line content, not whole schema trees. */
export function getSchemaRevisionFieldDiff(id: string, oid: string, baseOid: string | undefined, path: string, limit = 200): Promise<SchemaFieldDiff> {
  schemaRepositoryPath(id);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("Choose 1–5000 diff rows.");
  return serialized(async database => {
    if (!await readMetadata(database, id)) throw new Error("This schema could not be found in this browser.");
    const { before, after } = await schemaComparison(id, oid, baseOid);
    const left = schemaPointerValue(before, path);
    const right = schemaPointerValue(after, path);
    if (sameSchemaValue(left, right)) throw new Error("This field has no changes between the selected commits.");
    return schemaLineDiff(JSON.stringify(left, null, 2), JSON.stringify(right, null, 2), limit);
  });
}

export function readSchemaVersion(id: string, oid: string): Promise<Record<string, unknown>>
{
  schemaRepositoryPath(id);
  return serialized(async database => {
    if (!await readMetadata(database, id)) throw new Error("This schema could not be found in this browser.");
    // A source revision can intentionally contain contracts the executable
    // adapter rejects. Inspection must return that exact committed source.
    const document: unknown = JSON.parse(await versionText(id, oid));
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("The historical schema is invalid.");
    return document as Record<string, unknown>;
  });
}
