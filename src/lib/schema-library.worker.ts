// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import "./worker-runtime.ts";
import { createSchemaDocumentId, parseSchemaDocument, schemaDocumentMaxBytes, validateSchemaDocument } from "./schema-documents.ts";
import { listSchemaMetadata, readSchemaDiscovery, readSchemaDocument, readSchemaOperations, releaseSchemaDocument,
  schemaMetadataIdentity, putSchemaDocument, renameSchemaDocument, moveSchemaDocument,
  deleteSchemaDocument, setSchemaDocumentEnabled, configureSchemaDefaults } from "./schema-storage.ts";
import { serviceSchemaDescriptors, readServiceSchema } from "./service-schema-packs.ts";
import { serviceIndexDescriptors, readServiceSchemaIndex, schemaAdapterRevision } from "./service-schema-indexes.ts";
import { inspectServiceSchema } from "./service-catalog.ts";
import type { SchemaDownload, SchemaLibrarySnapshot } from "./schema-library-types.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";
import { prepareStorageNamespaces } from "./storage-namespace.ts";

const indexes = new Map(serviceIndexDescriptors.map(index => [index.id, index]));
configureSchemaDefaults({ adapterRevision: schemaAdapterRevision,
  catalogs: serviceSchemaDescriptors.map(catalog => ({ id: catalog.id, name: catalog.name,
    file: `${catalog.id}.${catalog.protocol === "json-rpc" ? "schema" : "openapi"}.json`, revision: catalog.sha256, bytes: catalog.bytes, summary: indexes.get(catalog.id)!.summary })),
  read: readServiceSchema, readIndex: readServiceSchemaIndex, validate: inspectServiceSchema,
  inspectOperation: (document, id, operation) => inspectServiceSchema(document, id, new Set([operation.id]), operation).operations[0]!,
});

let published = new Map<string, string>();
async function snapshot(reset = false): Promise<SchemaLibrarySnapshot>
{
  const records = await listSchemaMetadata();
  const next = new Map<string, string>();
  const snapshot: SchemaLibrarySnapshot = { records: [], catalogs: [], active: [] };
  for (const record of records)
  {
    const identity = schemaMetadataIdentity(record);
    let summary = record.summary;
    if (record.enabled)
    {
      snapshot.active.push(record.id);
      next.set(record.id, identity);
      if (reset || published.get(record.id) !== identity)
      {
        const discovery = await readSchemaDiscovery(record.id);
        summary = discovery.summary;
        const name = record.displayName ?? summary.name;
        const groups = record.groups ?? (record.displayName
          ? discovery.groups.map(group => ({ ...group, name })) : discovery.groups);
        snapshot.catalogs.push({ catalog: { id: record.id, file: record.file, name, document: discovery.document,
          groups, execution: { kind: summary.protocol ?? "http", origin: summary.serverUrl } }, operations: discovery.operations, sourceIdentity: identity });
      }
    }
    snapshot.records.push({ id: record.id, file: record.file, enabled: record.enabled,
      createdAt: record.createdAt, updatedAt: record.updatedAt, sourceIdentity: identity,
      ...(record.displayName ? { displayName: record.displayName } : {}),
      summary: summary ? { ...summary, description: summary.description?.trim() || summary.name,
        name: record.displayName ?? summary.name }
        : { name: record.displayName ?? record.file, serverUrl: "", operationCount: null } });
  }
  published = next;
  return snapshot;
}

async function readUpload(file: File, id: string): Promise<Record<string, unknown>>
{
  if (file.size > schemaDocumentMaxBytes) throw new Error("Schema files must be no larger than 10 MiB.");
  return validateSchemaDocument(parseSchemaDocument(await file.text(), file.name), id).document;
}

serveWorkerRpc({
  prepareStorage: prepareStorageNamespaces,
  load: () => snapshot(true),
  models: readSchemaOperations,
  document: async (id: string, identity: string) => {
    try { return (await readSchemaDocument(id, identity)).document; }
    finally { releaseSchemaDocument(id); }
  },
  releaseDocument: releaseSchemaDocument,
  async upload(file: File) {
    const id = createSchemaDocumentId();
    const document = await readUpload(file, id);
    const now = Date.now();
    await putSchemaDocument({ id, file: file.name, document, enabled: true, createdAt: now, updatedAt: now });
    return snapshot();
  },
  async replace(id: string, file: File) {
    const record = await readSchemaDocument(id);
    const document = await readUpload(file, id);
    const { groups: _groups, displayName: _displayName, ...metadata } = record;
    await putSchemaDocument({ ...metadata, document, file: file.name, updatedAt: Date.now() });
    return snapshot();
  },
  async rename(id: string, name: string) { await renameSchemaDocument(id, name); return snapshot(); },
  async move(id: string, targetId: string, placement: "before" | "after") {
    await moveSchemaDocument(id, targetId, placement); return snapshot();
  },
  async enabled(id: string, enabled: boolean) {
    await setSchemaDocumentEnabled(id, enabled, { metadataOnly: true }); return snapshot();
  },
  async delete(id: string) { await deleteSchemaDocument(id); return snapshot(); },
  async download(id: string, identity: string): Promise<SchemaDownload> {
    const record = await readSchemaDocument(id, identity);
    try {
      return { text: `${JSON.stringify(record.document, null, 2)}\n`,
        filename: `${record.file.replace(/\.(?:json|ya?ml)$/i, "").replace(/[^a-z0-9._-]+/gi, "-").toLowerCase() || "schema"}.json` };
    } finally { releaseSchemaDocument(id); }
  },
});
