// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { catalogsIndexDatabaseName } from "../storage-names.ts";
import { VaultError, type ApprovedOperation } from "./types.ts";

/** Written only by schema-storage together with authoritative catalog metadata. */
export type SchemaCredentialPolicies = Record<string, { revision: string; fingerprints: string[] }>;

/** Read the current schema policy without importing Git, trusting page state or creating storage. */
export async function assertCurrentSchema(descriptor: ApprovedOperation): Promise<void>
{
  const id = descriptor?.operation?.id;
  const separator = typeof id === "string" ? id.indexOf(":") : -1;
  if (separator < 1 || !/^[a-f0-9]{64}$/.test(descriptor.fingerprint)) throw new VaultError("PERMISSION");
  const schemaId = id.slice(0, separator);
  await new Promise<void>((resolve, reject) =>
  {
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let settled = false;
    const finish = (error?: VaultError) =>
    {
      if (settled) return;
      settled = true; clearTimeout(timer); database?.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() =>
    {
      finish(new VaultError("UNAVAILABLE"));
      try { transaction?.abort(); } catch { /* A completed transaction is already released. */ }
    }, 2500);
    let opening: IDBOpenDBRequest;
    try { opening = indexedDB.open(catalogsIndexDatabaseName); }
    catch { finish(new VaultError("UNAVAILABLE")); return; }
    opening.onblocked = () => finish(new VaultError("UNAVAILABLE"));
    opening.onerror = () => finish(new VaultError("PERMISSION"));
    // An absent database must remain absent, including after an open timeout.
    opening.onupgradeneeded = () => { opening.transaction?.abort(); finish(new VaultError("PERMISSION")); };
    opening.onsuccess = () =>
    {
      database = opening.result;
      if (settled) { database.close(); return; }
      database.onversionchange = () => database?.close();
      try
      {
        const active = database.transaction(["catalog", "pending", "removed", "state"], "readonly");
        transaction = active;
        const metadata = active.objectStore("catalog").get(schemaId);
        const pending = active.objectStore("pending").get(schemaId);
        const removed = active.objectStore("removed").get(schemaId);
        const policy = active.objectStore("state").get("vaultPolicy");
        active.onabort = () => finish(new VaultError("UNAVAILABLE"));
        active.onerror = () => finish(new VaultError("UNAVAILABLE"));
        active.oncomplete = () =>
        {
          const policies: unknown = policy.result;
          const entry = policies && typeof policies === "object" && !Array.isArray(policies) && Object.hasOwn(policies, schemaId)
            ? (policies as SchemaCredentialPolicies)[schemaId] : undefined;
          if (metadata.result?.id !== schemaId || metadata.result?.enabled !== true || pending.result !== undefined || removed.result !== undefined
            || !entry || typeof entry.revision !== "string" || !/^[a-f0-9]{40}$/.test(entry.revision)
            || !Array.isArray(entry.fingerprints) || !entry.fingerprints.includes(descriptor.fingerprint))
            finish(new VaultError("PERMISSION"));
          else finish();
        };
      }
      catch { finish(new VaultError("UNAVAILABLE")); }
    };
  });
}
