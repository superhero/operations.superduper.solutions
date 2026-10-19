// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-only adapter: exercise the production worker and authoritative schema DB.
import VaultWorker from "../../src/lib/secrets/vault.worker.ts?worker&inline";
import { deleteSchemaDocument, loadSchemaDocuments, putSchemaDocument, setSchemaDocumentEnabled } from "../../src/lib/schema-storage.ts";
import { validateSchemaDocument, type SchemaDocumentRecord } from "../../src/lib/schema-documents.ts";
import { assertCurrentSchema } from "../../src/lib/secrets/schema-policy-storage.ts";
import { approvedOperation } from "../../src/lib/secrets/policy.ts";
import { catalogsIndexDatabaseName } from "../../src/lib/storage-names.ts";
import { seed, synthetic, executionInput } from "./vault-storage.fixture.ts";
import type { ApprovedOperation } from "../../src/lib/secrets/types.ts";

let record: SchemaDocumentRecord;
let descriptor: ApprovedOperation;
let worker: Worker;
let sequence = 0;
let lastReply: unknown;
const replies = new Map<number, { resolve: (result: unknown) => void; reject: (error: unknown) => void }>();
function call(method: string, args: unknown[]) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { replies.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
}
async function catalog(write: boolean, run: (transaction: IDBTransaction) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(catalogsIndexDatabaseName);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["state", "pending", "removed", "catalog", "policies"], write ? "readwrite" : "readonly");
    run(transaction); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
  }); } finally { db.close(); }
}
export async function setup(origin: string, run: string, action = "ok") {
  const id = `vault-${crypto.randomUUID()}`;
  const path = `/vault-api/${run}/${action}`;
  const document = { openapi: "3.1.0", info: { title: "Vault browser fixture", version: "1.0.0" }, servers: [{ url: origin }],
    components: { securitySchemes: { Bearer: { type: "http", scheme: "bearer" }, Key: { type: "apiKey", in: "header", name: "X-Api-Key" } } },
    paths: { [path]: { get: { operationId: "secured", summary: "Secured fixture", security: [{ Bearer: [], Key: [] }],
      ...(action === "field-limit" ? { parameters: [{ in: "query", name: "field-" + "f".repeat(20 * 1024), required: true, schema: { type: "string" } }] } : {}),
      responses: { "200": { description: "Result", content: { "application/json": { schema: { type: "object" } } } } } } } } };
  record = { id, file: "vault.json", document, enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
  await loadSchemaDocuments(); await putSchemaDocument(record);
  descriptor = await approvedOperation(validateSchemaDocument(document, id).operations[0]!, origin);
  await assertCurrentSchema(descriptor);
  const seeded = await seed(origin, run, "ok", descriptor);
  worker = new VaultWorker({ name: "vault-policy-browser-test" });
  worker.onmessage = ({ data }) => {
    lastReply = data;
    if ("event" in data) { for (const pending of replies.values()) pending.reject(new Error("Worker unexpectedly locked")); replies.clear(); return; }
    const pending = replies.get(data.id); if (!pending) return; replies.delete(data.id);
    if (data.ok) pending.resolve(data.value); else pending.reject(Object.assign(new Error("Safe worker refusal"), { code: data.error.code }));
  };
  worker.onerror = () => { for (const pending of replies.values()) pending.reject(new Error("Worker failed")); replies.clear(); };
  await call("unlock", [{ methodId: seeded.status.methods.find(method => method.kind === "password")!.id, secret: synthetic.password }]);
  return { descriptor, status: seeded.status };
}
export async function execute() {
  const { binding } = executionInput();
  try { return { value: await call("execute", [descriptor, {}, binding]) }; }
  catch (error) { return { error: (error as { code?: string }).code ?? "UNEXPECTED" }; }
}
export async function diagnostic() { await execute(); return lastReply; }
export async function mutate(mode: string) {
  if (mode === "replacement") {
    const next = structuredClone(record);
    const paths = next.document.paths as Record<string, { get: { description?: string } }>;
    paths[descriptor.operation.path]!.get.description = "The operation changed while keeping its identity.";
    await putSchemaDocument(next);
  } else if (mode === "disabled") await setSchemaDocumentEnabled(record.id, false);
  else if (mode === "deleted") await deleteSchemaDocument(record.id);
  else if (mode === "pending" || mode === "removed") await catalog(true, tx => { tx.objectStore(mode).put(true, record.id); });
  else if (mode === "legacy") await catalog(true, tx => { tx.objectStore("policies").delete(record.id); });
  else throw new Error("Unknown fixture transition");
}
export async function backfill() { await loadSchemaDocuments(); return execute(); }
export async function absentDatabase() {
  const before = (await indexedDB.databases()).map(item => item.name);
  const unknown = await approvedOperation({ id: "absent:secured", name: "Absent", description: "", group: "Fixture",
    method: "GET", path: "/secured", fields: [], bodyRequired: false,
    security: [[{ name: "Bearer", kind: "bearer", header: "Authorization" }]] }, "https://example.test");
  let error;
  try { await assertCurrentSchema(unknown); error = "unexpected success"; }
  catch (failure) { error = (failure as { code: string }).code; }
  return { error, before, after: (await indexedDB.databases()).map(item => item.name) };
}


/** Exercise variable transport through the real worker without authentication schemes. */
export async function publicVariable(backfillLegacy = false) {
  const next = structuredClone(record);
  const operation = (next.document.paths as Record<string, { get: { security: unknown[]; parameters?: unknown[] } }>)[descriptor.operation.path]!.get;
  operation.security = [];
  operation.parameters = [{ in: "header", name: "X-Vault-Variable", required: true, schema: { type: "string" } }];
  record = next;
  await putSchemaDocument(record);
  descriptor = await approvedOperation(validateSchemaDocument(record.document, record.id).operations[0]!, descriptor.origin);
  const { binding } = executionInput();
  const variables = [{ key: "header:X-Vault-Variable", path: [], credentialId: binding.credentials.Bearer }];
  const execute = () => call("execute", [descriptor, { "header:X-Vault-Variable": "[Vault variable]" },
    { alternative: 0, credentials: {}, fingerprint: descriptor.fingerprint }, undefined, variables]);
  let before;
  if (backfillLegacy) {
    await catalog(true, tx => {
      const request = tx.objectStore("policies").get(record.id);
      request.onsuccess = () => {
        const policy = request.result;
        delete policy.version;
        policy.fingerprints = [];
        tx.objectStore("policies").put(policy, record.id);
      };
    });
    try { await execute(); before = "unexpected success"; }
    catch (error) { before = (error as { code?: string }).code; }
    await loadSchemaDocuments();
  }
  const value = await execute();
  return { before, value };
}

export async function factoryPolicy() {
  const digest = "a".repeat(64);
  const set = async (revision: string) => catalog(true, tx => {
    const metadata = tx.objectStore("catalog");
    const read = metadata.get(record.id);
    read.onsuccess = () => metadata.put({ ...read.result, factoryDigest: digest }, record.id);
    tx.objectStore("policies").put({ revision, fingerprints: [descriptor.fingerprint] }, record.id);
  });
  await set(digest);
  await assertCurrentSchema(descriptor);
  await set("b".repeat(64));
  try { await assertCurrentSchema(descriptor); return "unexpected success"; }
  catch (error) { return (error as { code: string }).code; }
}
