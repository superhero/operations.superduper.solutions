// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import LightningFS from "@isomorphic-git/lightning-fs";
import { Buffer } from "buffer";
import * as git from "isomorphic-git";
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import { bundledCatalogs } from "./catalog-registry.ts";
import { operationServerUrl, validateSchemaDocument, validateSchemaDocumentId, type SchemaDocumentRecord } from "./schema-documents.ts";
import { catalogsDatabaseName, catalogsIndexDatabaseName } from "./storage-names.ts";
import { approvedOperation } from "./secrets/policy.ts";
import { VaultError } from "./secrets/types.ts";
import type { SchemaCredentialPolicies } from "./secrets/schema-policy-storage.ts";

if (!("Buffer" in globalThis)) Object.defineProperty(globalThis, "Buffer", { value: Buffer, configurable: true, writable: true });

type SchemaMetadata = Omit<SchemaDocumentRecord, "document"> & { repositoryPath: string; factoryDigest?: string };
type SchemaDefaults = {
  catalogs: readonly { id: string; name: string; file: string; revision: string }[];
  read: (id: string) => Promise<Record<string, unknown>>;
  validate: (document: Record<string, unknown>, id: string) => ReturnType<typeof validateSchemaDocument>;
};
let defaults: SchemaDefaults | undefined;
const factoryDocuments = new Map<string, Record<string, unknown>>();
/** Supply factory documents at the worker boundary; storage remains reusable with authored catalogs. */
export function configureSchemaDefaults(value: SchemaDefaults): void { defaults = value; }
function validateLibraryDocument(document: unknown, id: string) {
  return defaults?.catalogs.some(catalog => catalog.id === id)
    ? defaults.validate(document as Record<string, unknown>, id) : validateSchemaDocument(document, id);
}
type PendingSchema = { metadata: SchemaMetadata; revision: string; previousRevision: string | null };
interface SchemaDatabase extends DBSchema
{
  catalog: { key: string; value: SchemaMetadata };
  pending: { key: string; value: PendingSchema };
  removed: { key: string; value: true };
  state: { key: "seeded" | "order" | "vaultPolicy" | "serviceDefaults"; value: boolean | string[] | SchemaCredentialPolicies };
}
type StoreName = "catalog" | "pending" | "removed" | "state";
type Database = IDBPDatabase<SchemaDatabase>;
const timeout = 2500;
const filepath = "schema.json";
const mainRef = "refs/heads/main";
const lockName = `schema-repositories:${catalogsDatabaseName}`;
let filesystem: LightningFS | undefined;
let queue: Promise<unknown> = Promise.resolve();

export type SchemaRevision = { oid: string; message: string; timestamp: number; parents: string[] };

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
  const opening = Promise.resolve().then(() => openDB<SchemaDatabase>(catalogsIndexDatabaseName, 1, {
    upgrade(database, _oldVersion, _newVersion, transaction)
    {
      void transaction.done.catch(() => {});
      if (expired) { transaction.abort(); return; }
      for (const name of ["catalog", "pending", "removed", "state"] as const) database.createObjectStore(name);
      void transaction.objectStore("state").put(false, "seeded").catch(() => {});
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

function orderedMetadata(records: SchemaMetadata[], order: boolean | string[] | SchemaCredentialPolicies | undefined): SchemaMetadata[]
{
  records.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  const remaining = new Map(records.map(record => [record.id, record]));
  const sorted: SchemaMetadata[] = [];
  for (const id of Array.isArray(order) ? order : [])
  {
    const record = remaining.get(id);
    if (record) { sorted.push(record); remaining.delete(id); }
  }
  return [...sorted, ...remaining.values()];
}

function readOrderedMetadata(database: Database): Promise<SchemaMetadata[]>
{
  return transaction(database, ["catalog", "state"], "readonly", async active => {
    const [records, order] = await Promise.all([
      active.objectStore("catalog").getAll(), active.objectStore("state").get("order"),
    ]);
    return orderedMetadata(records, order);
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

async function head(id: string): Promise<string | null>
{
  try { return await git.resolveRef({ fs: fs(), dir: schemaRepositoryPath(id), ref: mainRef }); }
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
  let raw: unknown;
  if (factoryDigest) {
    const key = `${record.id}:${factoryDigest}`;
    if (!defaults || !defaults.catalogs.some(catalog => catalog.id === record.id && catalog.revision === factoryDigest))
      throw new Error(`The factory schema ${record.id} is unavailable.`);
    if (!factoryDocuments.has(key)) factoryDocuments.set(key, await defaults.read(record.id));
    raw = factoryDocuments.get(key)!;
  } else raw = JSON.parse(await fs().promises.readFile(`${repositoryPath}/${filepath}`, "utf8"));
  const { document } = validateLibraryDocument(raw, record.id);
  return { ...record, document };
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
  return { revision, fingerprints, version: 2 };
}

async function storeCredentialPolicy(active: IDBPTransaction<SchemaDatabase, StoreName[], "readwrite">,
  id: string, policy: SchemaCredentialPolicies[string] | undefined): Promise<void>
{
  const previous = policyMap(await active.objectStore("state").get("vaultPolicy"));
  const next = { ...previous };
  if (policy) Object.defineProperty(next, id, { value: policy, enumerable: true, configurable: true });
  else delete next[id];
  await active.objectStore("state").put(next, "vaultPolicy");
}

/** Upgrade existing catalogs under their repository lock before they are published. */
async function backfillCredentialPolicies(database: Database): Promise<void>
{
  const [records, saved] = await transaction(database, ["catalog", "state"], "readonly", active => Promise.all([
    active.objectStore("catalog").getAll(), active.objectStore("state").get("vaultPolicy"),
  ]));
  const previous = policyMap(saved);
  const policies: SchemaCredentialPolicies = {};
  let changed = Object.keys(previous).length !== records.length || saved === undefined;
  for (const metadata of records)
  {
    const revision = metadata.factoryDigest ?? await head(metadata.id);
    if (!revision) throw new Error(`Schema ${metadata.id} has no committed revision for credential policy.`);
    const existing = Object.hasOwn(previous, metadata.id) ? previous[metadata.id] : undefined;
    if (existing?.version === 2 && existing.revision === revision && Array.isArray(existing.fingerprints) && (metadata.enabled || !existing.fingerprints.length))
      Object.defineProperty(policies, metadata.id, { value: existing, enumerable: true });
    else
    {
      const policy = await credentialPolicy(await readRecord(metadata), revision);
      Object.defineProperty(policies, metadata.id, { value: policy, enumerable: true });
      changed = true;
    }
  }
  if (changed) await transaction(database, ["state"], "readwrite", async active => { await active.objectStore("state").put(policies, "vaultPolicy"); });
}

async function finishPending(database: Database, pending: PendingSchema): Promise<void>
{
  const metadata = validateMetadata(pending.metadata);
  const id = metadata.id;
  const current = await head(id);
  if (current !== pending.previousRevision && current !== pending.revision)
    throw new Error(`Schema ${id} changed while a previous save was unfinished. Its repository has been preserved.`);
  const text = await versionText(id, pending.revision);
  const document = validateLibraryDocument(JSON.parse(text), id).document;
  const policy = await credentialPolicy({ ...metadata, document }, pending.revision);
  const dir = metadata.repositoryPath;
  await fs().promises.writeFile(`${dir}/${filepath}`, text, "utf8");
  await git.add({ fs: fs(), dir, filepath });
  await fs().promises.flush();
  await git.writeRef({ fs: fs(), dir, ref: mainRef, value: pending.revision, force: true });
  await fs().promises.flush();
  await transaction(database, ["catalog", "pending", "state"], "readwrite", async active => {
    if (!await active.objectStore("catalog").get(id))
    {
      const [records, order] = await Promise.all([
        active.objectStore("catalog").getAll(), active.objectStore("state").get("order"),
      ]);
      await active.objectStore("state").put([...orderedMetadata(records, order).map(record => record.id), id], "order");
    }
    await active.objectStore("catalog").put(metadata, id);
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

async function writeRecord(database: Database, record: SchemaDocumentRecord, commitMessage?: string): Promise<SchemaDocumentRecord>
{
  const existing = await readMetadata(database, record.id);
  const previousRevision = await head(record.id);
  const dir = schemaRepositoryPath(record.id);
  const { document, ...details } = record;
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const unchanged = existing && previousRevision && await versionText(record.id, previousRevision) === text;
  const metadata = validateMetadata({ ...details, createdAt: existing?.createdAt ?? record.createdAt,
    enabled: existing?.enabled ?? record.enabled, repositoryPath: dir });
  // Metadata (including enablement) is deliberately outside Git. Identical documents add no revision.
  if (unchanged)
  {
    const policy = await credentialPolicy({ ...record, enabled: metadata.enabled }, previousRevision);
    await transaction(database, ["catalog", "state"], "readwrite", async active => {
      await active.objectStore("catalog").put(metadata, record.id);
      await storeCredentialPolicy(active, record.id, policy);
    });
    return readRecord(metadata);
  }
  await mkdir("/repositories");
  await mkdir(dir);
  if (!await exists(`${dir}/.git/HEAD`)) await git.init({ fs: fs(), dir, defaultBranch: "main" });
  // Construct an immutable commit before replacing the authoritative working file.
  // The journal contains only metadata and OIDs, never a second copy of the schema.
  const blob = await git.writeBlob({ fs: fs(), dir, blob: new TextEncoder().encode(text) });
  const tree = await git.writeTree({ fs: fs(), dir, tree: [{ mode: "100644", path: filepath, oid: blob, type: "blob" }] });
  const author = { name: "Local schema manager", email: "schema@localhost", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
  const info = document.info as { title: string; version: string };
  const label = `${info.title} (v${info.version})`.replace(/\s+/g, " ").trim();
  const revision = await git.writeCommit({ fs: fs(), dir, commit: {
    tree, parent: previousRevision ? [previousRevision] : [], author, committer: author,
    message: `${commitMessage ?? `${previousRevision ? "Replace" : "Import"} OpenAPI schema: ${label}`}\n`,
  } });
  await fs().promises.flush();
  const pending = { metadata, revision, previousRevision };
  await transaction(database, ["pending"], "readwrite", async active => { await active.objectStore("pending").put(pending, record.id); });
  await finishPending(database, pending);
  return readRecord(metadata);
}

async function initialize(database: Database): Promise<void>
{
  await recover(database);
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
  if (defaults) await transaction(database, ["catalog", "state"], "readwrite", async active => {
    const store = active.objectStore("state");
    const previous = await store.get("serviceDefaults");
    const installed = new Set(Array.isArray(previous) ? previous : []);
    for (const catalog of defaults!.catalogs) {
      const existing = await active.objectStore("catalog").get(catalog.id);
      if (!installed.has(catalog.id) && !existing) {
        await active.objectStore("catalog").put({ id: catalog.id, file: catalog.file, displayName: catalog.name,
          repositoryPath: schemaRepositoryPath(catalog.id), factoryDigest: catalog.revision,
          enabled: true, createdAt: now, updatedAt: now }, catalog.id);
      } else if (existing?.factoryDigest && existing.factoryDigest !== catalog.revision) {
        // Unmodified factory copies follow bundled updates; authored Git copies do not.
        await active.objectStore("catalog").put({ ...existing, factoryDigest: catalog.revision, updatedAt: now }, catalog.id);
      }
      installed.add(catalog.id);
    }
    await store.put([...installed], "serviceDefaults");
  });
  await backfillCredentialPolicies(database);
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
      try { await initialize(connection); return await task(connection); }
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
    const records = await readOrderedMetadata(database);
    const loaded: SchemaDocumentRecord[] = [];
    for (const record of records) loaded.push(await readRecord(record));
    return loaded;
  });
}

/** Card order is application metadata, independent from document contents and Git history. */
export function moveSchemaDocument(id: string, targetId: string, placement: "before" | "after"): Promise<void>
{
  validateSchemaDocumentId(id);
  validateSchemaDocumentId(targetId);
  if (placement !== "before" && placement !== "after") throw new Error("Choose whether to place the schema before or after its target.");
  return serialized(async database => {
    const ids = (await readOrderedMetadata(database)).map(record => record.id);
    if (!ids.includes(id) || !ids.includes(targetId)) throw new Error("This schema could not be found in this browser.");
    if (id === targetId) return;
    const reordered = ids.filter(entry => entry !== id);
    reordered.splice(reordered.indexOf(targetId) + (placement === "after" ? 1 : 0), 0, id);
    if (reordered.every((entry, index) => entry === ids[index])) return;
    await transaction(database, ["state"], "readwrite", async active => {
      await active.objectStore("state").put(reordered, "order");
    });
  });
}

export function putSchemaDocument(value: SchemaDocumentRecord): Promise<SchemaDocumentRecord>
{
  const { document } = validateLibraryDocument(value.document, value.id);
  // Snapshot before queuing, so callers cannot mutate an in-flight import.
  const record = structuredClone({ ...value, document });
  validateMetadata({ ...record, repositoryPath: schemaRepositoryPath(record.id) });
  return serialized(database => writeRecord(database, record));
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
    const record = await readRecord(metadata);
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
export function setSchemaDocumentEnabled(id: string, enabled: boolean): Promise<SchemaDocumentRecord>
{
  validateSchemaDocumentId(id);
  if (typeof enabled !== "boolean") throw new Error("Schema enablement must be Boolean.");
  return serialized(async database => {
    const metadata = await readMetadata(database, id);
    if (!metadata) throw new Error("This schema could not be found in this browser.");
    const record = await readRecord(metadata);
    const revision = metadata.factoryDigest ?? await head(id);
    if (!revision) throw new Error(`Schema ${id} has no committed revision for credential policy.`);
    const policy = await credentialPolicy({ ...record, enabled }, revision);
    await transaction(database, ["catalog", "state"], "readwrite", async active => {
      await active.objectStore("catalog").put({ ...metadata, enabled }, id);
      await storeCredentialPolicy(active, id, policy);
    });
    return { ...record, enabled };
  });
}

export function deleteSchemaDocument(id: string): Promise<void>
{
  const path = schemaRepositoryPath(id);
  return serialized(async database => {
    await transaction(database, ["catalog", "pending", "removed", "state"], "readwrite", async active => {
      await active.objectStore("removed").put(true, id);
      await active.objectStore("catalog").delete(id);
      await active.objectStore("pending").delete(id);
      await storeCredentialPolicy(active, id, undefined);
      const order = await active.objectStore("state").get("order");
      if (Array.isArray(order)) await active.objectStore("state").put(order.filter(entry => entry !== id), "order");
    });
    await removeTree(path);
    await fs().promises.flush();
    await transaction(database, ["removed"], "readwrite", async active => { await active.objectStore("removed").delete(id); });
  });
}

export function getSchemaHistory(id: string): Promise<SchemaRevision[]>
{
  schemaRepositoryPath(id);
  return serialized(async database => {
    if (!await readMetadata(database, id)) throw new Error("This schema could not be found in this browser.");
    const metadata = await readMetadata(database, id);
    if (metadata?.factoryDigest) await writeRecord(database, await readRecord(metadata));
    return (await git.log({ fs: fs(), dir: schemaRepositoryPath(id), ref: mainRef })).map(({ oid, commit }) => ({
      oid, message: commit.message.trim(), timestamp: commit.committer.timestamp * 1000, parents: commit.parent,
    }));
  });
}

export function readSchemaVersion(id: string, oid: string): Promise<Record<string, unknown>>
{
  schemaRepositoryPath(id);
  return serialized(async database => {
    if (!await readMetadata(database, id)) throw new Error("This schema could not be found in this browser.");
    return validateLibraryDocument(JSON.parse(await versionText(id, oid)), id).document;
  });
}
