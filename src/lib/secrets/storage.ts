// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { vaultDatabaseName, VaultError, type VaultSnapshot } from "./types.ts";

/** The durable counter survives deleting/restoring a vault and invalidates suspended tabs. */
export type VaultState = { revision: number; lockEpoch: number; snapshot: VaultSnapshot | null };
export interface VaultStorage {
  read(): Promise<VaultState>;
  replace(expected: VaultState, snapshot: VaultSnapshot | null): Promise<VaultState>;
  lock(): Promise<VaultState>;
}
const initial = (): VaultState => ({ revision: 0, lockEpoch: 0, snapshot: null });
const deadline = 2500;

/** Only encrypted snapshots and public counters enter this database. No fallback store. */
export function createVaultStorage(): VaultStorage {
  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let request: IDBOpenDBRequest;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new VaultError("UNAVAILABLE")); } };
      const timer = setTimeout(fail, deadline);
      try { request = indexedDB.open(vaultDatabaseName, 1); }
      catch { fail(); return; }
      request.onblocked = fail;
      request.onerror = fail;
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return; }
        request.result.createObjectStore("vault");
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true; clearTimeout(timer);
        database.onversionchange = () => database.close();
        resolve(database);
      };
    });
  }

  async function transaction(change?: (previous: VaultState) => VaultState): Promise<VaultState> {
    const database = await open();
    try {
      return await new Promise<VaultState>((resolve, reject) => {
        const tx = database.transaction("vault", change ? "readwrite" : "readonly", { durability: "strict" });
        const store = tx.objectStore("vault");
        let result: VaultState;
        let failure: VaultError | undefined;
        const timer = setTimeout(() => { failure = new VaultError("UNAVAILABLE"); try { tx.abort(); } catch { /* Already completed. */ } }, deadline);
        tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
        tx.onabort = () => { clearTimeout(timer); reject(failure ?? new VaultError("UNAVAILABLE")); };
        const request = store.get("current");
        request.onsuccess = () => {
          try {
            const previous: VaultState = request.result ?? initial();
            if (!Number.isSafeInteger(previous.revision) || previous.revision < 0
              || !Number.isSafeInteger(previous.lockEpoch) || previous.lockEpoch < 0)
              throw new VaultError("INVALID");
            result = change ? change(previous) : previous;
            if (change) store.put(result, "current");
          } catch (error) {
            failure = error instanceof VaultError ? error : new VaultError("UNAVAILABLE");
            try { tx.abort(); } catch { /* The failed write may already have aborted it. */ }
          }
        };
      });
    } catch (error) { throw error instanceof VaultError ? error : new VaultError("UNAVAILABLE"); }
    finally { database.close(); }
  }

  async function write(change: (previous: VaultState) => VaultState): Promise<VaultState> {
    if (!globalThis.navigator?.locks) throw new VaultError("UNAVAILABLE");
    try {
      return await navigator.locks.request("operations-secret-vault", { mode: "exclusive", signal: AbortSignal.timeout(deadline) },
        () => transaction(change));
    } catch (error) { throw error instanceof VaultError ? error : new VaultError("UNAVAILABLE"); }
  }
  const advance = (previous: VaultState, snapshot = previous.snapshot): VaultState => {
    if (previous.revision >= Number.MAX_SAFE_INTEGER || previous.lockEpoch >= Number.MAX_SAFE_INTEGER) throw new VaultError("LIMIT");
    return { revision: previous.revision + 1, lockEpoch: previous.lockEpoch + 1, snapshot };
  };
  return {
    read: () => transaction(),
    replace: (expected, snapshot) => write(previous => {
      if (previous.revision !== expected.revision || previous.lockEpoch !== expected.lockEpoch) throw new VaultError("CONFLICT");
      return advance(previous, snapshot);
    }),
    lock: () => write(previous => advance(previous)),
  };
}
