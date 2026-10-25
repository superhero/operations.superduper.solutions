// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { configureSchemaDefaults, listSchemaMetadata, readSchemaDiscovery, readSchemaDocument, readSchemaOperation, readSchemaOperations,
  releaseSchemaDocument, schemaMetadataIdentity, setSchemaDocumentEnabled, getSchemaHistory,
  readSchemaVersion, renameSchemaDocument, deleteSchemaDocument, putSchemaDocument, updateSchemaUpstream,
  getSchemaBranchHistory, getSchemaRevisionDiff, getSchemaRevisionFieldDiff, resolveSchemaUpdate, dismissSchemaUpdate, updateSchemaFromBundle } from "../../src/lib/schema-storage.ts";
import { applySchemaPatches, googleOauthAlternatives } from "../../src/lib/schema-patches.ts";
import { inspectServiceSchema } from "../../src/lib/service-catalog.ts";
import { createSchemaDiscovery } from "../../src/lib/schema-index.ts";
import { approvedOperation } from "../../src/lib/secrets/policy.ts";
import { assertCurrentSchema } from "../../src/lib/secrets/schema-policy-storage.ts";
export { approvedNativeOperation } from "../../src/lib/secrets/native-rpc-policy.ts";

export { listSchemaMetadata, readSchemaDiscovery, readSchemaDocument, readSchemaOperation, readSchemaOperations, releaseSchemaDocument,
  schemaMetadataIdentity, setSchemaDocumentEnabled, getSchemaHistory, readSchemaVersion,
  renameSchemaDocument, deleteSchemaDocument, putSchemaDocument, approvedOperation, assertCurrentSchema,
  updateSchemaUpstream, getSchemaBranchHistory, getSchemaRevisionDiff, getSchemaRevisionFieldDiff, resolveSchemaUpdate, dismissSchemaUpdate, updateSchemaFromBundle };
const reads: Record<string, number> = {};
const indexReads: Record<string, number> = {};
const failures = new Set<string>();
const adapterRevision = "a".repeat(64);
export const counters = () => ({ reads: { ...reads }, indexes: { ...indexReads } });
export const failRead = (id: string) => failures.add(id);

export async function setupCapabilities(document: Record<string, unknown>) {
  const id = "capability-fixture", bytes = new TextEncoder().encode(JSON.stringify(document));
  const revision = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  const discovery = createSchemaDiscovery(inspectServiceSchema(document, id), revision);
  configureSchemaDefaults({ adapterRevision, catalogs: [{ id, name: "Capability fixture", file: "capabilities.json", revision,
    bytes: bytes.length, summary: discovery.summary }],
    read: async () => { reads[id] = (reads[id] ?? 0) + 1; return structuredClone(document); },
    readIndex: async () => { indexReads[id] = (indexReads[id] ?? 0) + 1; return structuredClone(discovery); }, validate: inspectServiceSchema,
    inspectOperation: (source, id, operation) => inspectServiceSchema(source, id, new Set([operation.id]), operation).operations[0]!,
  });
  return (await listSchemaMetadata()).find(record => record.id === id)!;
}

export async function setupNative(version = 0) {
  const id = "native-fixture", protocolVersion = `0.163.${version}`;
  const document = { $schema: "http://json-schema.org/draft-07/schema#", info: { title: "Native fixture", version: protocolVersion },
    "x-codex-app-server": { protocol: "json-rpc", version: protocolVersion }, definitions: {
      ClientRequest: { oneOf: Array.from({ length: 18 }, (_, index) => ({ type: "object", properties: {
        id: { $ref: "#/definitions/RequestId" }, method: { type: "string", enum: [`read/${index}`] },
        params: { $ref: "#/definitions/Params" } }, required: ["id", "method", "params"] })) },
      RequestId: { type: "integer" }, Params: { type: "object", properties: { input: { type: "string", minLength: version } }, required: ["input"] },
      ServerRequest: {}, ClientNotification: {}, ServerNotification: {},
      JSONRPCResponse: { type: "object", properties: { id: { $ref: "#/definitions/RequestId" }, result: true }, required: ["id", "result"] },
      JSONRPCError: { type: "object", properties: { id: { $ref: "#/definitions/RequestId" }, error: {
        type: "object", properties: { code: { type: "integer" }, message: { type: "string" } }, required: ["code", "message"] } }, required: ["id", "error"] },
    } };
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const revision = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  const index = createSchemaDiscovery(inspectServiceSchema(document, id), revision);
  configureSchemaDefaults({ adapterRevision, catalogs: [{ id, name: "Native fixture", file: "native.schema.json", revision, bytes: bytes.length, summary: index.summary }],
    read: async () => { reads[id] = (reads[id] ?? 0) + 1; return structuredClone(document); },
    readIndex: async () => structuredClone(index), validate: inspectServiceSchema,
    inspectOperation: (source, id, operation) => inspectServiceSchema(source, id, new Set([operation.id]), operation).operations[0]!,
  });
  return (await listSchemaMetadata()).find(record => record.id === id)!;
}

export function googleDocument(version = 1, fixed = false): Record<string, any> {
  const scopes = { "https://www.googleapis.com/auth/cloud-platform": "Google Cloud access" };
  const required = Object.keys(scopes);
  const authorizationUrl = "https://accounts.google.com/o/oauth2/auth";
  return { openapi: "3.0.3", info: { title: "Google fixture", version: String(version), description: `Upstream version ${version}.` },
    servers: [{ url: "https://schema.example.test" }],
    components: { securitySchemes: {
      Oauth2: { type: "oauth2", flows: { implicit: { authorizationUrl, scopes } } },
      Oauth2c: { type: "oauth2", flows: { authorizationCode: { authorizationUrl, tokenUrl: "https://accounts.google.com/o/oauth2/token", scopes } } },
    } },
    paths: { "/items": { get: { operationId: "list", summary: "List items", security: fixed
      ? [{ Oauth2: required }, { Oauth2c: required }] : [{ Oauth2: required, Oauth2c: required }],
      responses: { "200": { description: `Version ${version}`, content: { "application/json": { schema: { type: "object" } } } } } } } },
  };
}

export async function setupGoogle(version = 1, fixed = false, name = "Google fixture") {
  const raw = googleDocument(version, fixed);
  const document = applySchemaPatches(raw, [googleOauthAlternatives]);
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const revision = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  const id = "google-fixture";
  const index = createSchemaDiscovery(inspectServiceSchema(document, id), revision);
  configureSchemaDefaults({ adapterRevision, catalogs: [{ id, name, file: "google.json", revision,
    bytes: bytes.length, summary: index.summary, patches: [googleOauthAlternatives] }],
    read: async () => { reads[id] = (reads[id] ?? 0) + 1; return structuredClone(document); },
    readUpstream: async () => { reads[`${id}:upstream`] = (reads[`${id}:upstream`] ?? 0) + 1; return structuredClone(raw); },
    readIndex: async () => structuredClone(index), validate: inspectServiceSchema,
    inspectOperation: (source, id, operation) => inspectServiceSchema(source, id, new Set([operation.id]), operation).operations[0]!,
  });
  return listSchemaMetadata();
}

export async function setup(version = 1, operationCount = 1, names: Record<string, string> = {}) {
  const documents = new Map(["factory-a", "factory-b"].map(id => [id, {
    openapi: "3.1.0", info: { title: `${id} v${version}`, version: String(version), description: `Description of ${id} v${version}.` },
    servers: [{ url: "https://schema.example.test/v1" }],
    paths: Object.fromEntries(Array.from({ length: operationCount }, (_, index) => [index ? `/items-${index}` : "/items", { get: { operationId: index ? `list${index}` : "list", summary: `List items ${index}`, parameters: [{
      name: "limit", in: "query", schema: { type: "integer", minimum: 1 },
    }], responses: { "200": { description: "OK" } } } }])),
  }]));
  const catalogs = [];
  const prepared = new Map<string, ReturnType<typeof createSchemaDiscovery>>();
  for (const [id, document] of documents) {
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const revision = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    const discovery = createSchemaDiscovery(inspectServiceSchema(document, id), revision);
    prepared.set(id, discovery);
    catalogs.push({ id, name: names[id] ?? document.info.title, file: `${id}.json`, revision, bytes: bytes.length, summary: discovery.summary });
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

export async function editStore(store: string, id: string, mutate: "corrupt-index" | "corrupt-policy" | "delete-policy" | "delete") {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("v1/catalogs/index");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const data = tx.objectStore(store);
      if (mutate === "delete-policy" || mutate === "delete") data.delete(id);
      else {
        const read = data.get(id);
        read.onsuccess = () => data.put(mutate === "corrupt-policy" ? { ...read.result, fingerprints: null }
          : { ...read.result, discovery: { ...read.result.discovery, sourceRevision: "corrupt" } }, id);
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
