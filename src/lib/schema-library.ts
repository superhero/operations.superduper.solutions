// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { fromStore, writable } from "svelte/store";
import { operations, publishPreparedCatalogs, operationForId, operationDescriptorForId, operationSourceIdentity,
  installOperationModel, pinOperationModels, type PreparedCatalog, type Operation, type OperationModel } from "./catalog.ts";
import { catalogs as registeredCatalogs } from "./catalog-registry.ts";
import type { WorkflowDocument } from "./workflow-document.ts";
import { prepareOperationMatching } from "./operation-matching-client.ts";
import { workflowOperationIds } from "./schema-models.ts";
import type { SchemaDownload, SchemaLibraryRecord, SchemaLibrarySnapshot } from "./schema-library-types.ts";
import SchemaLibraryWorker from "./schema-library.worker.ts?worker&inline";
import { createWorkerClient } from "./worker-rpc.ts";
import { logger } from "./logger.ts";
import { invalidateVaultExecution } from "./secrets/client.ts";

const state = writable({ records: [] as SchemaLibraryRecord[], operations, catalogs: registeredCatalogs,
  revision: "", busy: false, initialized: false, error: "" });
const current = fromStore(state);
const worker = createWorkerClient(() => new SchemaLibraryWorker({ name: "operations-schema-library" }), { scope: "schema-library" });
import.meta.hot?.dispose(() => worker.dispose());
let pending: Promise<void> = Promise.resolve();
let prepared = new Map<string, PreparedCatalog>();
const loadingModels = new Map<string, Promise<Operation>>();

export function getSchemaLibrary() { return current.current; }

export function prepareSavedStorage(): Promise<void> { return worker.call("prepareStorage"); }

function applySnapshot({ records, catalogs, active }: SchemaLibrarySnapshot): void
{
  const next = new Map(prepared);
  for (const entry of catalogs) next.set(entry.catalog.id, entry);
  const entries = active.map(id => {
    const entry = next.get(id);
    if (!entry) throw new Error("The background schema index is incomplete. Reload documents to try again.");
    return entry;
  });
  const revision = JSON.stringify(entries.map(entry => [entry.catalog.id, entry.sourceIdentity]).sort(([left], [right]) => left!.localeCompare(right!)));
  publishPreparedCatalogs(entries);
  prepared = new Map(entries.map(entry => [entry.catalog.id, entry]));
  if (current.current.initialized && revision !== current.current.revision) invalidateVaultExecution();
  prepareOperationMatching(operations);
  state.update(value => ({ ...value, records, operations, catalogs: registeredCatalogs, revision, initialized: true }));
}

export async function hydrateOperation(id: string): Promise<Operation>
{
  const existing = operationForId(id);
  if (existing) return existing;
  const identity = operationSourceIdentity(id);
  if (!identity || !operationDescriptorForId(id)) throw new Error("This operation is not available in the registered schemas.");
  const key = `${id}:${identity}`;
  if (!loadingModels.has(key)) {
    const work = worker.call<OperationModel>("model", [id, identity]).then(installOperationModel)
      .finally(() => { if (loadingModels.get(key) === work) loadingModels.delete(key); });
    loadingModels.set(key, work);
  }
  return loadingModels.get(key)!;
}

/** Each open workflow/run pins only its models; closing releases that ownership. */
export function createWorkflowSchemaLease()
{
  const owner = {};
  return {
    async update(document: WorkflowDocument): Promise<void> {
      const ids = workflowOperationIds(document);
      pinOperationModels(owner, ids);
      for (const id of ids) {
        const descriptor = operationDescriptorForId(id);
        // Missing/unsupported operations keep their saved graph and are diagnosed
        // by the runner, rather than preventing the entire canvas from opening.
        if (descriptor && !descriptor.unavailableReason) await hydrateOperation(id);
      }
    },
    release() { pinOperationModels(owner); },
  };
}

export async function loadSchemaSource(id: string): Promise<Record<string, unknown>> {
  const identity = findRecord(id).sourceIdentity;
  const document = await worker.call<Record<string, unknown>>("document", [id, identity]);
  if (findRecord(id).sourceIdentity !== identity) throw new Error("The schema changed while its document was loading. Try again.");
  return document;
}

export function releaseSchemaSource(id: string): void {
  void worker.call("releaseDocument", [id]).catch(error => logger.warn("Could not release a schema document.", error));
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

function findRecord(id: string): SchemaLibraryRecord
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

export function downloadSchema(record: Pick<SchemaLibraryRecord, "id">): void
{
  void run(async () => {
    const latest = findRecord(record.id);
    const { text, filename } = await worker.call<SchemaDownload>("download", [record.id, latest.sourceIdentity]);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
