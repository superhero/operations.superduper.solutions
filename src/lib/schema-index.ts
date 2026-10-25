// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { CatalogGroup } from "./catalog-registry.ts";
import { isCodexSchema } from "./codex-schema.ts";
import { summarizeOperationCapabilities, validateOperationCapabilities, validateCapabilitySummary } from "./operation-capabilities.ts";

export const schemaIndexVersion = 2;
export type SchemaSummary = { name: string; description?: string; serverUrl: string; operationCount: number; unavailableCount?: number; protocol?: "json-rpc" };
export type SchemaDiscovery = {
  version: typeof schemaIndexVersion;
  sourceRevision: string;
  summary: SchemaSummary;
  document: Record<string, unknown>;
  groups: CatalogGroup[];
  operations: Operation[];
};

/** Descriptors deliberately cannot execute until a canonical model is loaded. */
export function operationDescriptor(operation: Operation): Operation
{
  const summary = summarizeOperationCapabilities(operation);
  return { id: operation.id, name: operation.name, method: operation.method, path: operation.path,
    group: operation.group, description: "", fields: [], bodyRequired: false, deferred: true,
    ...(operation.unavailableReason ? { unavailableReason: operation.unavailableReason } : {}),
    ...(summary ? { capabilitySummary: summary } : {}) };
}

export function createSchemaSummary(inspected: { document: Record<string, unknown>; name: string;
  serverUrl: string; operations: Operation[] }): SchemaSummary
{
  const { document, name, serverUrl, operations } = inspected;
  const info = document.info as { description?: unknown };
  const description = typeof info.description === "string" ? info.description.trim() : "";
  return { name, serverUrl, ...(description ? { description } : {}), operationCount: operations.length,
    ...(isCodexSchema(document) ? { protocol: "json-rpc" as const } : {}),
    unavailableCount: operations.filter(operation => operation.unavailableReason).length };
}

export function createSchemaDiscovery(inspected: { document: Record<string, unknown>; name: string;
  serverUrl: string; operations: Operation[]; groups: CatalogGroup[] }, sourceRevision: string): SchemaDiscovery
{
  const { document, serverUrl, operations, groups } = inspected;
  const info = document.info as { title: string; version: string };
  return { version: schemaIndexVersion, sourceRevision,
    summary: createSchemaSummary(inspected),
    document: isCodexSchema(document) ? { $schema: document.$schema, info: { title: info.title, version: info.version },
      "x-codex-app-server": document["x-codex-app-server"] } : { openapi: document.openapi, info: { title: info.title, version: info.version },
      servers: [{ url: serverUrl }], paths: {} }, groups, operations: operations.map(operationDescriptor) };
}

export function validateSchemaDiscovery(value: unknown, id: string, revision: string): SchemaDiscovery
{
  const index = value as SchemaDiscovery;
  if (!index || index.version !== schemaIndexVersion || index.sourceRevision !== revision || !index.document
    || !index.summary || typeof index.summary.name !== "string" || typeof index.summary.serverUrl !== "string"
    || (index.summary.description !== undefined && typeof index.summary.description !== "string")
    || !Array.isArray(index.operations) || !Array.isArray(index.groups)
    || index.operations.length !== index.summary.operationCount) throw new Error(`The discovery index for ${id} is invalid or outdated.`);
  const seen = new Set<string>();
  for (const operation of index.operations) {
    if (typeof operation.id !== "string" || !operation.id.startsWith(`${id}:`) || seen.has(operation.id)
      || typeof operation.name !== "string" || typeof operation.path !== "string" || typeof operation.method !== "string"
      || operation.deferred !== true || operation.fields?.length !== 0) throw new Error(`The discovery index for ${id} contains an invalid operation.`);
    seen.add(operation.id);
    if (operation.capabilities !== undefined) validateOperationCapabilities(operation.capabilities);
    if (operation.capabilitySummary !== undefined) validateCapabilitySummary(operation.capabilitySummary, operation.unavailableReason);
  }
  return index;
}
