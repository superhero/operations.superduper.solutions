// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { configureSchemaDefaults, listSchemaMetadata, readSchemaDiscovery, readSchemaDocument, readSchemaOperation,
  releaseSchemaDocument, schemaMetadataIdentity, setSchemaDocumentEnabled, moveSchemaDocument, getSchemaHistory,
  readSchemaVersion, renameSchemaDocument, deleteSchemaDocument, putSchemaDocument } from "../../src/lib/schema-storage.ts";
import { inspectServiceSchema } from "../../src/lib/service-catalog.ts";
import { createSchemaDiscovery } from "../../src/lib/schema-index.ts";
import { approvedOperation } from "../../src/lib/secrets/policy.ts";
import { assertCurrentSchema } from "../../src/lib/secrets/schema-policy-storage.ts";

export { listSchemaMetadata, readSchemaDiscovery, readSchemaDocument, readSchemaOperation, releaseSchemaDocument,
  schemaMetadataIdentity, setSchemaDocumentEnabled, moveSchemaDocument, getSchemaHistory, readSchemaVersion,
  renameSchemaDocument, deleteSchemaDocument, putSchemaDocument, approvedOperation, assertCurrentSchema };
const reads: Record<string, number> = {};
const indexReads: Record<string, number> = {};
const failures = new Set<string>();
const adapterRevision = "a".repeat(64);
export const counters = () => ({ reads: { ...reads }, indexes: { ...indexReads } });
export const failRead = (id: string) => failures.add(id);

export async function setup(version = 1) {
  const documents = new Map(["factory-a", "factory-b"].map(id => [id, {
    openapi: "3.1.0", info: { title: `${id} v${version}`, version: String(version) },
    servers: [{ url: "https://schema.example.test/v1" }],
    paths: { "/items": { get: { operationId: "list", summary: "List items", parameters: [{
      name: "limit", in: "query", schema: { type: "integer", minimum: 1 },
    }], responses: { "200": { description: "OK" } } } } },
  }]));
  const catalogs = [];
  const prepared = new Map<string, ReturnType<typeof createSchemaDiscovery>>();
  for (const [id, document] of documents) {
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const revision = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    const discovery = createSchemaDiscovery(inspectServiceSchema(document, id), revision);
    prepared.set(id, discovery);
    catalogs.push({ id, name: document.info.title, file: `${id}.json`, revision, bytes: bytes.length, summary: discovery.summary });
  }
  configureSchemaDefaults({ catalogs, adapterRevision,
    read: async id => {
      reads[id] = (reads[id] ?? 0) + 1;
      if (failures.delete(id)) throw new Error("Injected schema read failure");
      return structuredClone(documents.get(id)!);
    },
    readIndex: async id => { indexReads[id] = (indexReads[id] ?? 0) + 1; return structuredClone(prepared.get(id)!); },
    validate: inspectServiceSchema,
    inspectOperation: (document, id, operation) => inspectServiceSchema(document, id, new Set([operation.id]), operation).operations[0]!,
  });
  return listSchemaMetadata();
}

export async function editStore(store: string, id: string, mutate: "corrupt-index" | "corrupt-policy" | "delete-policy") {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("v1/catalogs/index");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const data = tx.objectStore(store);
      if (mutate === "delete-policy") data.delete(id);
      else {
        const read = data.get(id);
        read.onsuccess = () => data.put(mutate === "corrupt-policy" ? { ...read.result, fingerprints: null }
          : { ...read.result, discovery: { ...read.result.discovery, sourceRevision: "corrupt" } }, id);
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
