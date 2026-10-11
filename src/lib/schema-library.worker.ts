// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import "./worker-runtime.ts";
import { createSchemaDocumentId, parseSchemaDocument, schemaDocumentMaxBytes, validateSchemaDocument,
  type SchemaDocumentRecord } from "./schema-documents.ts";
import { loadSchemaDocuments, putSchemaDocument, renameSchemaDocument, moveSchemaDocument,
  deleteSchemaDocument, setSchemaDocumentEnabled } from "./schema-storage.ts";
import type { SchemaDownload, SchemaLibrarySnapshot } from "./schema-library-types.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";
import { prepareStorageNamespaces } from "./storage-namespace.ts";

async function snapshot(): Promise<SchemaLibrarySnapshot>
{
  const snapshot: SchemaLibrarySnapshot = { records: [], catalogs: [] };
  for (const record of await loadSchemaDocuments())
  {
    const validated = validateSchemaDocument(record.document, record.id);
    snapshot.records.push({ ...record, document: validated.document, summary: { name: validated.name, serverUrl: validated.serverUrl,
      operationCount: validated.operations.length } });
    if (record.enabled) snapshot.catalogs.push({ catalog: {
      id: record.id, file: record.file, name: validated.name, document: validated.document,
      groups: record.groups ?? validated.groups, execution: { kind: "http", origin: validated.serverUrl },
    }, operations: validated.operations, sourceIdentity: JSON.stringify([record.file, validated.document]) });
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
    const { groups: _groups, ...metadata } = record;
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
