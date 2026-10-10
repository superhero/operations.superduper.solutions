// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { openDB, type IDBPDatabase } from "idb";
import { appSettingsDatabaseName } from "./app-settings.ts";
import { workflowFilesystemName, workflowRepositoryDatabaseName, workflowRepository } from "./workflow-repository.ts";
import type { DatabaseMetrics, DatabaseStoreMetrics, StorageReport } from "./storage-metrics-types.d.ts";

const knownDatabases = [appSettingsDatabaseName, workflowRepositoryDatabaseName, workflowFilesystemName, `${workflowFilesystemName}_lock`];
let pending: Promise<StorageReport> | undefined;

function message(error: unknown): string
{
  return error instanceof Error ? error.message : String(error);
}

function bytes(value: unknown): number | null
{
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

async function bounded<T>(operation: Promise<T>, label: string, duration = 5000): Promise<T>
{
  let timer: ReturnType<typeof setTimeout> | undefined;
  try
  {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not respond. Try refreshing.`)), duration);
    })]);
  }
  finally { clearTimeout(timer); }
}

async function browserMetrics(): Promise<StorageReport["browser"]>
{
  const result: StorageReport["browser"] = {
    usage: null, quota: null, remaining: null, utilization: null, persisted: null, breakdown: null,
    estimateError: null, persistenceError: null,
  };
  const manager = globalThis.navigator?.storage;
  await Promise.all([
    (async () => {
      try
      {
        if (!manager?.estimate) throw new Error("This browser does not expose storage estimates.");
        const estimate = await bounded(manager.estimate(), "Storage estimate");
        result.usage = bytes(estimate.usage);
        result.quota = bytes(estimate.quota);
        if (result.usage !== null && result.quota !== null)
        {
          result.remaining = Math.max(0, result.quota - result.usage);
          if (result.quota > 0) result.utilization = result.usage / result.quota;
        }
        const details = (estimate as StorageEstimate & { usageDetails?: Record<string, unknown> }).usageDetails;
        if (details && typeof details === "object" && !Array.isArray(details))
          result.breakdown = Object.entries(details).flatMap(([name, value]) => {
            const size = bytes(value);
            return size === null ? [] : [{ name, bytes: size }];
          }).sort((left, right) => right.bytes - left.bytes);
      }
      catch (error) { result.estimateError = message(error); }
    })(),
    (async () => {
      try
      {
        if (!manager?.persisted) throw new Error("This browser does not expose persistence status.");
        result.persisted = await bounded(manager.persisted(), "Persistence status");
      }
      catch (error) { result.persistenceError = message(error); }
    })(),
  ]);
  return result;
}

/** Inspect schema and counts only. Abort creation if a database disappeared or never existed. */
async function inspectDatabase(name: string, version: number | null): Promise<DatabaseMetrics | null>
{
  let database: IDBPDatabase | undefined;
  let absent = false;
  let finished = false;
  const result: DatabaseMetrics = { name, version, stores: [], error: null };
  try
  {
    const opening = openDB(name, undefined, {
      upgrade(_database, oldVersion, _newVersion, transaction) {
        absent = oldVersion === 0;
        void transaction.done.catch(() => {});
        transaction.abort();
      },
      blocking() { database?.close(); },
    });
    // An open request cannot be cancelled. Close a late connection after a timeout.
    void opening.then(value => { if (finished) value.close(); }, () => {});
    database = await bounded(opening, `Database ${name}`);
    result.version = database.version;
    const names = Array.from(database.objectStoreNames).sort();
    if (names.length)
    {
      const transaction = database.transaction(names, "readonly");
      void transaction.done.catch(() => {});
      try
      {
        const stores = names.map(async storeName => {
          const store = transaction.objectStore(storeName);
          const indexes = Array.from(store.indexNames).sort().map(indexName => {
            const index = store.index(indexName);
            return { name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
          });
          return { name: store.name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
            indexes, records: await store.count() } satisfies DatabaseStoreMetrics;
        });
        result.stores = await bounded(Promise.all(stores), `Record counts for ${name}`);
        await transaction.done;
      }
      catch (error)
      {
        try { transaction.abort(); } catch { /* A completed transaction is already released. */ }
        throw error;
      }
    }
  }
  catch (error)
  {
    if (absent) return null;
    result.error = message(error);
  }
  finally { finished = true; database?.close(); }
  return result;
}

async function indexedDBMetrics(): Promise<StorageReport["indexedDB"]>
{
  const result: StorageReport["indexedDB"] = { available: false, enumeration: "unavailable", databases: [], error: null };
  try
  {
    const factory = globalThis.indexedDB;
    if (!factory) throw new Error("IndexedDB is not available in this browser.");
    result.available = true;
    let names: { name: string; version: number | null }[];
    try
    {
      if (!factory.databases) throw new Error("Database enumeration is unavailable; showing known application databases only.");
      names = (await bounded(factory.databases(), "Database enumeration"))
        .flatMap(entry => entry.name ? [{ name: entry.name, version: entry.version ?? null }] : []);
      result.enumeration = "complete";
    }
    catch (error)
    {
      result.enumeration = "known";
      result.error = message(error);
      names = knownDatabases.map(name => ({ name, version: null }));
    }
    // Keep scans bounded in concurrency; no record values or LightningFS internals are read.
    for (const entry of names.sort((left, right) => left.name.localeCompare(right.name)))
    {
      const metrics = await inspectDatabase(entry.name, entry.version);
      if (metrics) result.databases.push(metrics);
    }
  }
  catch (error) { result.error = message(error); }
  return result;
}

/** A read-only, on-demand snapshot; callers share an in-progress collection. */
export function collectStorageReport(): Promise<StorageReport>
{
  pending ??= (async () => {
    const [browser, indexedDB, repositories] = await Promise.all([
      browserMetrics(), indexedDBMetrics(),
      bounded(workflowRepository.storageMetrics(), "Workflow storage metrics", 30000)
        .then(items => ({ items, error: null as string | null }))
        .catch(error => ({ items: [], error: message(error) })),
    ]);
    return { collectedAt: Date.now(), browser, indexedDB, repositories };
  })().finally(() => { pending = undefined; });
  return pending;
}
