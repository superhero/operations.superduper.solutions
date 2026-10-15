// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { fromStore, writable } from "svelte/store";
import { operations, publishPreparedCatalogs } from "./catalog.ts";
import type { SchemaDocumentRecord } from "./schema-documents.ts";
import type { SchemaDownload, SchemaLibraryRecord, SchemaLibrarySnapshot } from "./schema-library-types.ts";
import SchemaLibraryWorker from "./schema-library.worker.ts?worker&inline";
import { createWorkerClient } from "./worker-rpc.ts";
import { logger } from "./logger.ts";
import { invalidateVaultExecution } from "./secrets/client.ts";

const state = writable({ records: [] as SchemaLibraryRecord[], operations, busy: false, initialized: false, error: "" });
const current = fromStore(state);
const worker = createWorkerClient(() => new SchemaLibraryWorker({ name: "operations-schema-library" }), { scope: "schema-library" });
import.meta.hot?.dispose(() => worker.dispose());
let pending: Promise<void> = Promise.resolve();

export function getSchemaLibrary() { return current.current; }

export function prepareSavedStorage(): Promise<void> { return worker.call("prepareStorage"); }

function applySnapshot({ records, catalogs }: SchemaLibrarySnapshot): void
{
  const previous = JSON.stringify(operations);
  publishPreparedCatalogs(catalogs);
  if (current.current.initialized && previous !== JSON.stringify(operations)) invalidateVaultExecution();
  state.update(value => ({ ...value, records, operations, initialized: true }));
}

async function update(method: string, args: unknown[] = []): Promise<void>
{
  applySnapshot(await worker.call<SchemaLibrarySnapshot>(method, args));
}

function run(action: () => Promise<void>): Promise<void>
{
  pending = pending.then(async () => {
    state.update(value => ({ ...value, busy: true, error: "" }));
    try { await action(); }
    catch (error)
    {
      state.update(value => ({ ...value, error: error instanceof Error ? error.message : "Could not update schemas." }));
      logger.warn("Could not update OpenAPI schemas.", error);
    }
    finally { state.update(value => ({ ...value, busy: false })); }
  });
  return pending;
}

export function loadSchemaLibrary(): Promise<void>
{
  return run(() => update("load"));
}

function requireReady(): void
{
  if (!current.current.initialized) throw new Error("Load saved schemas before making changes. Use Retry to try again.");
}

function findRecord(id: string): SchemaDocumentRecord
{
  requireReady();
  const record = current.current.records.find(record => record.id === id);
  if (!record) throw new Error("This schema is no longer available. Reload the schema list and try again.");
  return record;
}

export function uploadSchema(file: File): Promise<void>
{
  return run(async () => {
    requireReady();
    await update("upload", [file]);
  });
}

export function replaceSchema(id: string, file: File): Promise<void>
{
  return run(async () => {
    findRecord(id);
    await update("replace", [id, file]);
  });
}

export async function renameSchema(id: string, name: string): Promise<void>
{
  let failure: { error: unknown } | undefined;
  await run(async () => {
    try
    {
      findRecord(id);
      await update("rename", [id, name]);
    }
    catch (error) { failure = { error }; throw error; }
  });
  // Keep the editor open on failure while retaining the shared error display and logging.
  if (failure) throw failure.error;
}

export function setSchemaEnabled(id: string, enabled: boolean): Promise<void>
{
  return run(async () => {
    findRecord(id);
    await update("enabled", [id, enabled]);
  });
}

export function moveSchema(id: string, targetId: string, placement: "before" | "after"): Promise<void>
{
  return run(async () => {
    findRecord(id);
    await update("move", [id, targetId, placement]);
  });
}

export function deleteSchema(id: string): Promise<void>
{
  return run(async () => {
    findRecord(id);
    await update("delete", [id]);
  });
}

export function downloadSchema(record: SchemaDocumentRecord): void
{
  void run(async () => {
    findRecord(record.id);
    const { text, filename } = await worker.call<SchemaDownload>("download", [record.id]);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
