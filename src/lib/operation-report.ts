// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { catalogForOperation, type CatalogGroup } from "./catalog-registry.ts";
import type { Operation } from "./catalog.ts";

type RecordValue = Record<string, unknown>;
type Group = { id: string; name: string; description: string };
type Kind = "object" | "map" | "data" | "links" | "link";

export type OperationReport = {
  catalog: { file: string; title: string; version: string; openapi: string };
  operationId: string;
  summary: string;
  description: string;
  groups: Group[];
  schema: RecordValue;
  warnings: string[];
};

const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const namedMaps = new Set(["paths", "webhooks", "schemas", "securitySchemes", "parameters", "responses",
  "requestBodies", "headers", "examples", "callbacks", "pathItems", "content", "encoding", "variables",
  "properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const literalValues = new Set(["$ref", "operationRef", "example", "default", "enum", "const", "value", "security", "mapping", "scopes"]);

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function operationAt(document: RecordValue, path: string, method: string) {
  const verb = method.toLowerCase();
  const item = record(record(document.paths)?.[path]);
  const operation = record(item?.[verb]);
  if (!methods.has(verb) || !item || !operation || typeof document.openapi !== "string")
    throw new Error(`Schema unavailable for ${method.toUpperCase()} ${path}: the catalog does not define this OpenAPI operation.`);
  return { item, operation, verb };
}

function childKind(kind: Kind, key: string, value: unknown): Kind {
  if (kind === "data") return "data";
  if (kind === "map") return "object";
  if (kind === "links") return "link";
  if (literalValues.has(key) || key === "examples" && Array.isArray(value)
    || kind === "link" && ["parameters", "requestBody"].includes(key) || key.startsWith("x-")) return "data";
  if (key === "links") return "links";
  return namedMaps.has(key) && !Array.isArray(value) ? "map" : "object";
}

/** Keep the selected operation and its local reference closure at their original pointers. */
export function scopeOperationSchema(document: RecordValue, path: string, method: string): { schema: RecordValue; warnings: string[] } {
  const { item, operation, verb } = operationAt(document, path, method);
  const configuredServers = operation.servers ?? item.servers ?? document.servers;
  const servers = configuredServers === undefined || Array.isArray(configuredServers) && !configuredServers.length
    ? [{ url: "/" }] : configuredServers;
  const security = operation.security ?? document.security;
  const schema: RecordValue = structuredClone({
    openapi: document.openapi,
    ...(document.info !== undefined ? { info: document.info } : {}),
    ...(document.jsonSchemaDialect !== undefined ? { jsonSchemaDialect: document.jsonSchemaDialect } : {}),
    servers,
    ...(security !== undefined ? { security } : {}),
    paths: { [path]: Object.fromEntries(Object.entries(item).filter(([key]) => !methods.has(key) || key === verb)) }
  });
  const warnings: string[] = [];
  const visited = new Set<unknown>();

  function include(reference: unknown) {
    if (visited.has(reference)) return;
    visited.add(reference);
    const warn = (reason: string) => { warnings.push(`${String(reference)}: ${reason}`); };
    if (typeof reference !== "string") return warn("A reference must be a string.");
    if (!reference.startsWith("#")) return warn("External references are not fetched.");
    let pointer: string;
    try { pointer = decodeURIComponent(reference.slice(1)); }
    catch { return warn("The local reference has invalid URL encoding."); }
    if (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer))
      return warn("The reference must identify a local JSON pointer.");
    const keys = pointer.slice(1).split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (keys[0] === "paths" && (keys.length < 3 || keys[1] !== path || methods.has(keys[2]!) && keys[2] !== verb))
      return warn("The reference includes operations outside this report.");
    let target: unknown = document;
    let kind: Kind = "object";
    for (const key of keys) {
      if (!target || typeof target !== "object" || !Object.hasOwn(target, key))
        return warn("The local reference was not found in the source catalog.");
      const child = (target as RecordValue)[key];
      kind = childKind(kind, key, child);
      target = child;
    }
    const copy: unknown = structuredClone(target);
    let output = schema;
    let source: unknown = document;
    for (const [index, key] of keys.entries()) {
      source = (source as RecordValue)[key];
      if (index === keys.length - 1) {
        Object.defineProperty(output, key, { value: copy, enumerable: true, writable: true, configurable: true });
      } else {
        if (!Object.hasOwn(output, key))
          Object.defineProperty(output, key, { value: Array.isArray(source) ? [] : {}, enumerable: true, writable: true, configurable: true });
        output = output[key] as RecordValue;
      }
    }
    visit(copy, kind);
  }

  function visit(value: unknown, kind: Kind = "object") {
    if (kind === "data" || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, kind);
      return;
    }
    if (kind !== "map" && kind !== "links" && Object.hasOwn(value, "$ref")) include((value as RecordValue).$ref);
    if (kind === "link" && Object.hasOwn(value, "operationRef")) include((value as RecordValue).operationRef);
    for (const [key, child] of Object.entries(value)) visit(child, childKind(kind, key, child));
  }

  visit(schema);
  if (Array.isArray(security)) {
    for (const requirement of security) {
      for (const name of Object.keys(requirement))
        include(`#/components/securitySchemes/${encodeURIComponent(name.replace(/~/g, "~0").replace(/\//g, "~1"))}`);
    }
  }
  return { schema, warnings };
}

function groupPath(groups: CatalogGroup[], operationId: string): Group[] {
  for (const group of groups) {
    const current = { id: group.id, name: group.name, description: group.description };
    if (group.operationIds?.includes(operationId)) return [current];
    const children = groupPath(group.children ?? [], operationId);
    if (children.length) return [current, ...children];
  }
  return [];
}

/** Resolve reports only from bundled catalogs; imported graph labels are not source schemas. */
export function getOperationReport(operation: Operation): OperationReport {
  const catalog = catalogForOperation(operation.id);
  if (!catalog)
    throw new Error(`Schema unavailable for ${operation.id}: its source catalog is not bundled.`);
  const { operation: source } = operationAt(catalog.document, operation.path, operation.method);
  if (operation.id !== `${catalog.id}:${source.operationId}`)
    throw new Error(`Schema unavailable for ${operation.id}: its identifier does not match the catalog endpoint.`);
  const info = catalog.document.info as { title: string; version: string };
  return {
    catalog: { file: catalog.file, title: info.title, version: info.version, openapi: catalog.document.openapi as string },
    operationId: source.operationId as string,
    summary: source.summary as string,
    description: source.description as string,
    groups: groupPath(catalog.groups, operation.id),
    ...scopeOperationSchema(catalog.document, operation.path, operation.method)
  };
}
