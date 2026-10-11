// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import LightningFS from "@isomorphic-git/lightning-fs";
import { deleteDB, openDB, type IDBPDatabase, type IDBPTransaction } from "idb";

const markerStore = "__operations_namespace_migration__";
const markerPath = "/.operations-namespace-migration.json";
const openTimeout = 5000;
type MigrationGuard = (copy: () => Promise<void>) => Promise<void>;
type UpgradeTransaction = IDBPTransaction<unknown, string[], "versionchange">;
type MigrationMarker = { version: 1; source: string; target: string; state: "copying" | "complete" };
type StoreSnapshot = {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
  records: { key: IDBValidKey; value: unknown }[];
};

/** Open requests cannot be cancelled; abort late upgrades and close late connections. */
async function openBounded(name: string, version: number | undefined,
  upgrade?: (database: IDBPDatabase, oldVersion: number, transaction: UpgradeTransaction) => void): Promise<IDBPDatabase>
{
  let expired = false;
  let opened: IDBPDatabase | undefined;
  let upgradeError: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = openDB(name, version, {
    upgrade(database, oldVersion, _newVersion, transaction)
    {
      void transaction.done.catch(() => {});
      if (expired) { transaction.abort(); return; }
      try { upgrade?.(database, oldVersion, transaction); }
      catch (error) { upgradeError = error; transaction.abort(); }
    },
    blocking() { opened?.close(); },
  });
  void opening.then(database => { opened = database; if (expired) database.close(); }, () => {});
  try
  {
    return await Promise.race([opening, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new DOMException(`Opening storage ${name} did not respond within ${openTimeout / 1000} seconds. Close other app tabs and retry.`, "TimeoutError"));
      }, openTimeout);
    })]);
  }
  catch (error) { throw upgradeError ?? error; }
  finally { clearTimeout(timer); }
}

/** Aborting first creation probes existence without leaving an empty legacy database. */
async function openExisting(name: string): Promise<IDBPDatabase | undefined>
{
  let absent = false;
  try
  {
    return await openBounded(name, undefined, (_database, oldVersion, transaction) => {
      if (oldVersion === 0) { absent = true; transaction.abort(); }
    });
  }
  catch (error)
  {
    if (absent && error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
}

async function serialized(target: string, operation: () => Promise<void>): Promise<void>
{
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new Error("Storage migration requires browser Web Locks support.");
  await navigator.locks.request(`operations-storage-migration:${target}`, operation);
}

async function populated(database: IDBPDatabase): Promise<boolean>
{
  const names = Array.from(database.objectStoreNames);
  if (!names.length) return false;
  const transaction = database.transaction(names, "readonly");
  const [counts] = await Promise.all([
    Promise.all(names.map(name => transaction.objectStore(name).count())), transaction.done,
  ]);
  return counts.some(count => count > 0);
}

async function snapshot(database: IDBPDatabase): Promise<StoreSnapshot[]>
{
  const names = Array.from(database.objectStoreNames);
  if (names.includes(markerStore)) throw new Error(`Legacy database ${database.name} uses the reserved migration store.`);
  if (!names.length) return [];
  const transaction = database.transaction(names, "readonly");
  const [stores] = await Promise.all([Promise.all(names.map(async name => {
    const store = transaction.objectStore(name);
    const indexes = Array.from(store.indexNames).map(name => {
      const index = store.index(name);
      return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
    });
    const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
    return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes,
      records: keys.map((key, index) => ({ key, value: values[index] })) };
  })), transaction.done]);
  return stores;
}

function createSchema(database: IDBPDatabase, transaction: UpgradeTransaction, stores: StoreSnapshot[]): void
{
  for (const source of stores)
  {
    const store = database.objectStoreNames.contains(source.name)
      ? transaction.objectStore(source.name)
      : database.createObjectStore(source.name, { keyPath: source.keyPath, autoIncrement: source.autoIncrement });
    if (JSON.stringify(store.keyPath) !== JSON.stringify(source.keyPath) || store.autoIncrement !== source.autoIncrement)
      throw new Error(`Cannot migrate into incompatible object store ${source.name}.`);
    for (const definition of source.indexes)
    {
      if (!store.indexNames.contains(definition.name))
        store.createIndex(definition.name, definition.keyPath, { unique: definition.unique, multiEntry: definition.multiEntry });
      else
      {
        const index = store.index(definition.name);
        if (JSON.stringify(index.keyPath) !== JSON.stringify(definition.keyPath)
          || index.unique !== definition.unique || index.multiEntry !== definition.multiEntry)
          throw new Error(`Cannot migrate into incompatible index ${definition.name}.`);
      }
    }
  }
  if (!database.objectStoreNames.contains(markerStore)) database.createObjectStore(markerStore);
}

async function compatibleSchema(database: IDBPDatabase, stores: StoreSnapshot[]): Promise<boolean>
{
  if (stores.some(store => !database.objectStoreNames.contains(store.name))) return false;
  const names = Array.from(database.objectStoreNames);
  const transaction = database.transaction(names, "readonly");
  const compatible = stores.every(source => {
    const store = transaction.objectStore(source.name);
    return JSON.stringify(store.keyPath) === JSON.stringify(source.keyPath) && store.autoIncrement === source.autoIncrement
      && source.indexes.every(definition => {
        if (!store.indexNames.contains(definition.name)) return false;
        const index = store.index(definition.name);
        return JSON.stringify(index.keyPath) === JSON.stringify(definition.keyPath)
          && index.unique === definition.unique && index.multiEntry === definition.multiEntry;
      });
  });
  await transaction.done;
  return compatible;
}

/** Copy app-owned stores atomically. A populated destination always remains authoritative. */
export async function migrateDatabase(oldName: string, newName: string,
  guard: MigrationGuard = copy => copy()): Promise<void>
{
  if (oldName === newName) return;
  await serialized(newName, async () => {
    const source = await openExisting(oldName);
    if (!source) return;
    let target: IDBPDatabase | undefined;
    try
    {
      target = await openExisting(newName);
      if (target && await populated(target)) return;
      // An independently created destination owns its schema, even while empty.
      if (target && !target.objectStoreNames.contains(markerStore)) return;
      await guard(async () => {
        const stores = await snapshot(source);
        if (!target)
          target = await openBounded(newName, source.version, (database, _oldVersion, transaction) => createSchema(database, transaction, stores));
        else if (!await compatibleSchema(target, stores))
          throw new Error(`Cannot resume migration into incompatible database ${newName}.`);
        const names = Array.from(target.objectStoreNames);
        const transaction = target.transaction(names, "readwrite");
        // Include every store in this check and transaction, so a concurrent writer
        // can never have its independently populated destination overwritten.
        void transaction.done.catch(() => {});
        try
        {
          const counts = await Promise.all(names.map(name => transaction.objectStore(name).count()));
          if (!counts.some(count => count > 0))
          {
            for (const store of stores)
              for (const record of store.records)
                if (store.keyPath === null) await transaction.objectStore(store.name).put(record.value, record.key);
                else await transaction.objectStore(store.name).put(record.value);
            await transaction.objectStore(markerStore).put({ version: 1, source: oldName, target: newName, state: "complete" }, "migration");
          }
          await transaction.done;
        }
        catch (error)
        {
          try { transaction.abort(); } catch { /* Already aborted or completed. */ }
          throw error;
        }
      });
    }
    finally { source.close(); target?.close(); }
  });
}

function missing(error: unknown): boolean
{
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function exists(fs: LightningFS, path: string): Promise<boolean>
{
  try { await fs.promises.lstat(path); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}

async function remove(fs: LightningFS, path: string): Promise<void>
{
  const stat = await fs.promises.lstat(path);
  if (stat.isDirectory())
  {
    for (const name of await fs.promises.readdir(path)) await remove(fs, `${path}/${name}`);
    await fs.promises.rmdir(path);
  }
  else await fs.promises.unlink(path);
}

async function copyPath(source: LightningFS, target: LightningFS, path: string): Promise<void>
{
  const stat = await source.promises.lstat(path);
  if (stat.isSymbolicLink())
  {
    await target.promises.symlink(await source.promises.readlink(path), path);
    await target.promises.lutimes(path, new Date(stat.atimeMs), new Date(stat.mtimeMs));
    return;
  }
  if (stat.isDirectory())
  {
    await target.promises.mkdir(path, { mode: stat.mode });
    for (const name of await source.promises.readdir(path)) await copyPath(source, target, `${path}/${name}`);
  }
  else if (stat.isFile())
  {
    const bytes = await source.promises.readFile(path);
    // LightningFS can return null for missing backing content; never turn that
    // corruption into a successful migration with an empty replacement file.
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== stat.size)
      throw new Error(`Cannot migrate unreadable or inconsistent file ${path}.`);
    await target.promises.writeFile(path, bytes, { mode: stat.mode });
  }
  else throw new Error(`Cannot migrate unsupported filesystem entry ${path}.`);
  await target.promises.chown(path, stat.uid, stat.gid);
  await target.promises.utimes(path, new Date(stat.atimeMs), new Date(stat.mtimeMs));
}

/** Copy through LightningFS's public API, including .git and recovery journals. */
export async function migrateFilesystem(oldName: string, newName: string,
  guard: MigrationGuard = copy => copy()): Promise<void>
{
  if (oldName === newName) return;
  await serialized(newName, async () => {
    const legacy = await openExisting(oldName);
    if (!legacy) return;
    legacy.close();
    const destination = await openExisting(newName);
    destination?.close();
    let target: LightningFS | undefined;
    let marker: MigrationMarker | undefined;
    let entries: string[] = [];
    if (destination)
    {
      target = new LightningFS(newName, { defer: true });
      entries = await target.promises.readdir("/");
      if (entries.includes(markerPath.slice(1)))
      {
        marker = JSON.parse(await target.promises.readFile(markerPath, "utf8")) as MigrationMarker;
        if (marker?.version !== 1 || marker.source !== oldName || marker.target !== newName
          || (marker.state !== "copying" && marker.state !== "complete"))
          throw new Error(`Cannot resume unrecognized filesystem migration in ${newName}.`);
        if (marker.state === "complete") return;
      }
      else if (entries.length) return;
    }
    await guard(async () => {
      const source = new LightningFS(oldName, { defer: true });
      if (await exists(source, markerPath))
        throw new Error(`Legacy filesystem ${oldName} uses the reserved migration path ${markerPath}.`);
      target ??= new LightningFS(newName, { defer: true });
      if (!marker)
      {
        marker = { version: 1, source: oldName, target: newName, state: "copying" };
        await target.promises.writeFile(markerPath, JSON.stringify(marker));
        await target.promises.flush();
      }
      // Only a durable marker written by this migration permits replacement of
      // partial data. Consumers must await completion before opening this target.
      for (const name of entries)
        if (`/${name}` !== markerPath) await remove(target, `/${name}`);
      for (const name of await source.promises.readdir("/")) await copyPath(source, target, `/${name}`);
      await target.promises.flush();
      await target.promises.writeFile(markerPath, JSON.stringify({ ...marker, state: "complete" }));
      await target.promises.flush();
    });
    // Temporary instances release their connections through LightningFS's public
    // idle lifecycle; no private backend fields or persisted FS records are used.
  });
}

async function databaseExists(name: string): Promise<boolean>
{
  const database = await openExisting(name);
  database?.close();
  return database !== undefined;
}

function completeMarker(value: unknown, source: string, target: string): boolean
{
  if (typeof value !== "object" || value === null) return false;
  const marker = value as Partial<MigrationMarker>;
  return marker.version === 1 && marker.source === source && marker.target === target && marker.state === "complete";
}

async function verifyCompletedMigration(oldName: string, newName: string, filesystem: boolean): Promise<void>
{
  const database = await openExisting(newName);
  let marker: unknown;
  if (database)
  {
    try
    {
      if (!filesystem && database.objectStoreNames.contains(markerStore)) marker = await database.get(markerStore, "migration");
    }
    finally { database.close(); }
    if (filesystem)
    {
      const target = new LightningFS(newName, { defer: true });
      try { marker = JSON.parse(await target.promises.readFile(markerPath, "utf8")); }
      catch (error)
      {
        throw new Error(`Cannot remove ${oldName}: the completed migration marker in ${newName} could not be verified.`, { cause: error });
      }
    }
  }
  if (!completeMarker(marker, oldName, newName))
    throw new Error(`Cannot remove ${oldName}: ${newName} has no verified completed migration from that database.`);
}

async function deleteBounded(name: string): Promise<void>
{
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deleting = deleteDB(name, { blocked() { blocked = true; } });
  try
  {
    await Promise.race([deleting, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const reason = blocked ? "is waiting for another database connection to close" : "has not completed";
        // IndexedDB cannot cancel deletion requests. A blocked request may finish
        // later, once its remaining connections close.
        reject(new DOMException(`Removing retired storage ${name} ${reason}. Close other app tabs and reload to finish cleanup.`, "TimeoutError"));
      }, openTimeout);
    })]);
  }
  finally { clearTimeout(timer); }
}

/** Remove only a legacy database whose exact destination confirms a completed copy. */
export async function removeMigratedDatabase(oldName: string, newName: string, filesystem: boolean,
  guard: MigrationGuard = copy => copy()): Promise<void>
{
  if (oldName === newName) return;
  await serialized(newName, async () => {
    const sourceExists = await databaseExists(oldName);
    const lockName = `${oldName}_lock`;
    const lockExists = filesystem && await databaseExists(lockName);
    if (!sourceExists && !lockExists) return;
    await guard(async () => {
      await verifyCompletedMigration(oldName, newName, filesystem);
      if (sourceExists) await deleteBounded(oldName);
      // Older LightningFS releases used this exact auxiliary database. Check it
      // independently so a retry finishes cleanup after the main deletion succeeds.
      if (lockExists) await deleteBounded(lockName);
    });
  });
}
