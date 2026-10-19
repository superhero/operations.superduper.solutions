// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import "./worker-runtime.ts";
import { createSchemaDocumentId, parseSchemaDocument, schemaDocumentMaxBytes, validateSchemaDocument,
  type SchemaDocumentRecord } from "./schema-documents.ts";
import { loadSchemaDocuments, putSchemaDocument, renameSchemaDocument, moveSchemaDocument,
  deleteSchemaDocument, setSchemaDocumentEnabled, configureSchemaDefaults } from "./schema-storage.ts";
import { serviceSchemaDescriptors, readServiceSchema } from "./service-schema-packs.ts";
import { inspectServiceSchema } from "./service-catalog.ts";
import type { SchemaDownload, SchemaLibrarySnapshot } from "./schema-library-types.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";
import { prepareStorageNamespaces } from "./storage-namespace.ts";

const serviceIds = new Set(serviceSchemaDescriptors.map(catalog => catalog.id));
const inspected = new WeakMap<Record<string, unknown>, ReturnType<typeof inspectServiceSchema>>();
function inspect(document: Record<string, unknown>, id: string) {
  if (!serviceIds.has(id)) return validateSchemaDocument(document, id);
  if (!inspected.has(document)) inspected.set(document, inspectServiceSchema(document, id));
  return inspected.get(document)!;
}
configureSchemaDefaults({ catalogs: serviceSchemaDescriptors.map(catalog => ({
  id: catalog.id, name: catalog.name, file: `${catalog.id}.openapi.json`, revision: catalog.sha256,
})), read: readServiceSchema, validate: inspect });

const identities = new WeakMap<Record<string, unknown>, Map<string, Promise<string>>>();
function sourceIdentity(file: string, document: Record<string, unknown>): Promise<string> {
  if (!identities.has(document)) identities.set(document, new Map());
  const entries = identities.get(document)!;
  if (!entries.has(file)) entries.set(file, crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([file, document])))
    .then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")));
  return entries.get(file)!;
}
async function snapshot(): Promise<SchemaLibrarySnapshot>
{
  const snapshot: SchemaLibrarySnapshot = { records: [], catalogs: [] };
  for (const record of await loadSchemaDocuments())
  {
    const validated = inspect(record.document, record.id);
    const name = record.displayName ?? validated.name;
    const groups = record.groups ?? (record.displayName ? validated.groups.map(group => ({ ...group, name })) : validated.groups);
    snapshot.records.push({ ...record, document: validated.document, summary: { name, serverUrl: validated.serverUrl,
      operationCount: validated.operations.length, unavailableCount: validated.operations.filter(operation => operation.unavailableReason).length } });
    if (record.enabled) snapshot.catalogs.push({ catalog: {
      id: record.id, file: record.file, name, document: validated.document,
      groups, execution: { kind: "http", origin: validated.serverUrl },
    }, operations: validated.operations, sourceIdentity: await sourceIdentity(record.file, validated.document) });
  }
  return snapshot;
}

async function findRecord(id: string): Promise<SchemaDocumentRecord>
{
  const record = (await loadSchemaDocuments()).find(record => record.id === id);
  if (!record) throw new Error("This schema is no longer available. Reload the schema list and try again.");
  return record;
}

async function readUpload(file: File, id: string): Promise<Record<string, unknown>>
{
  if (file.size > schemaDocumentMaxBytes) throw new Error("Schema files must be no larger than 10 MiB.");
  return validateSchemaDocument(parseSchemaDocument(await file.text(), file.name), id).document;
}

serveWorkerRpc({
  prepareStorage: prepareStorageNamespaces,
  load: snapshot,
  async upload(file: File)
  {
    const id = createSchemaDocumentId();
    const document = await readUpload(file, id);
    const now = Date.now();
    await putSchemaDocument({ id, file: file.name, document, enabled: true, createdAt: now, updatedAt: now });
    return snapshot();
  },
  async replace(id: string, file: File)
  {
    const record = await findRecord(id);
    const document = await readUpload(file, id);
    const { groups: _groups, displayName: _displayName, ...metadata } = record;
    await putSchemaDocument({ ...metadata, document, file: file.name, updatedAt: Date.now() });
    return snapshot();
  },
  async rename(id: string, name: string)
  {
    await renameSchemaDocument(id, name);
    return snapshot();
  },
  async move(id: string, targetId: string, placement: "before" | "after")
  {
    await moveSchemaDocument(id, targetId, placement);
    return snapshot();
  },
  async enabled(id: string, enabled: boolean)
  {
    await setSchemaDocumentEnabled(id, enabled);
    return snapshot();
  },
  async delete(id: string)
  {
    await deleteSchemaDocument(id);
    return snapshot();
  },
  async download(id: string): Promise<SchemaDownload>
  {
    const record = await findRecord(id);
    return { text: `${JSON.stringify(record.document, null, 2)}\n`,
      filename: `${record.file.replace(/\.(?:json|ya?ml)$/i, "").replace(/[^a-z0-9._-]+/gi, "-").toLowerCase() || "schema"}.json` };
  },
});
