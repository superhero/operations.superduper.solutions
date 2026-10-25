// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";

type Document = Record<string, unknown>;
export type NativeSchema = boolean | Document;
export type NativeRpcContract = {
  version: string;
  method: string;
  paramsRequired: boolean;
  params?: NativeSchema;
  result: NativeSchema;
  error: NativeSchema;
};
export const codexExecutionLimitation = "Codex App Server requires a JSON-RPC connector. Execution is not enabled yet.";
const object = (value: unknown): value is Document => !!value && typeof value === "object" && !Array.isArray(value);
const schema = (value: unknown): value is NativeSchema => typeof value === "boolean" || object(value);
const literals = new Set(["default", "example", "examples", "enum", "const"]);
const maps = new Set(["properties", "patternProperties", "definitions", "$defs", "dependentSchemas"]);
export const nativeRpcMethod = /^[A-Za-z][A-Za-z0-9_/-]{0,511}$/;

/** Keep the selected wire request and its reference closure at their original pointers.
 * Results stay generic when the pinned wire schema does not map methods to result types. */
export function scopeNativeRpcSchema(document: Document, method: string): Document
{
  const metadata = document["x-codex-app-server"], info = document.info, definitions = document.definitions;
  if (!object(metadata) || metadata.protocol !== "json-rpc" || !object(info)
    || typeof info.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.version)
    || metadata.version !== info.version || document.$schema !== "http://json-schema.org/draft-07/schema#"
    || document.openapi !== undefined || document.paths !== undefined || document.servers !== undefined
    || !object(definitions) || !object(definitions.ClientRequest) || !Array.isArray(definitions.ClientRequest.oneOf)
    || !nativeRpcMethod.test(method)) throw new Error("Invalid native RPC model contract.");
  const requests = definitions.ClientRequest.oneOf.filter(value => object(value) && object(value.properties)
    && object(value.properties.method) && Array.isArray(value.properties.method.enum)
    && value.properties.method.enum.length === 1 && value.properties.method.enum[0] === method);
  const request = requests[0];
  if (requests.length !== 1 || !object(request) || request.type !== "object" || !object(request.properties)
    || !schema(request.properties.id) || !Array.isArray(request.required)
    || !request.required.includes("id") || !request.required.includes("method")
    || request.required.includes("params") && !schema(request.properties.params)
    || request.properties.params !== undefined && !schema(request.properties.params)
    || !schema(definitions.JSONRPCResponse) || !schema(definitions.JSONRPCError))
    throw new Error("The native RPC request, parameters or response schema is unavailable.");
  const result: Document = structuredClone({ $schema: document.$schema, info,
    "x-codex-app-server": metadata, definitions: { ClientRequest: { oneOf: [request] },
      JSONRPCResponse: definitions.JSONRPCResponse, JSONRPCError: definitions.JSONRPCError } });
  const visited = new Set<string>();
  let nodes = 0;
  function walk(value: unknown, depth = 0): void {
    if (++nodes > 100_000 || depth > 128) throw new Error("The native RPC schema exceeds the model complexity limit.");
    if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return; }
    if (!object(value)) return;
    if (Object.hasOwn(value, "$ref")) {
      const reference = value.$ref;
      if (typeof reference !== "string" || !reference.startsWith("#/definitions/") || /~(?:[^01]|$)/.test(reference))
        throw new Error("Native RPC models require resolvable local definition references.");
      if (!visited.has(reference)) {
        visited.add(reference);
        const parts = reference.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
        let target: unknown = document;
        for (const key of parts) target = object(target) && Object.hasOwn(target, key) ? target[key] : undefined;
        if (!schema(target)) throw new Error(`Unresolved native RPC reference: ${reference}`);
        let parent = result;
        for (const key of parts.slice(0, -1)) {
          if (!Object.hasOwn(parent, key)) Object.defineProperty(parent, key, { value: {}, enumerable: true, writable: true });
          if (!object(parent[key])) throw new Error("Conflicting native RPC reference.");
          parent = parent[key] as Document;
        }
        Object.defineProperty(parent, parts.at(-1)!, { value: structuredClone(target), enumerable: true, writable: true, configurable: true });
        walk(target, depth + 1);
      }
    }
    for (const [key, child] of Object.entries(value)) if (!literals.has(key) && key !== "$ref") {
      if (maps.has(key) && object(child)) { for (const entry of Object.values(child)) walk(entry, depth + 1); }
      else walk(child, depth + 1);
    }
  }
  walk(request); walk(definitions.JSONRPCResponse); walk(definitions.JSONRPCError);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024)
    throw new Error("The native RPC operation model must fit within 1 MiB.");
  return result;
}

/** Hydration and private policy validation use the same native contract. */
export function nativeRpcOperation(document: Document, operationId: string): Operation
{
  const separator = operationId.indexOf(":"), method = operationId.slice(separator + 1);
  if (separator < 1) throw new Error("Invalid native RPC operation identity.");
  const scoped = scopeNativeRpcSchema(document, method);
  const definitions = scoped.definitions as Document;
  const request = (definitions.ClientRequest as { oneOf: Document[] }).oneOf[0]!;
  const properties = request.properties as Document;
  const response = definitions.JSONRPCResponse;
  const responseProperties = object(response) && object(response.properties) ? response.properties : {};
  if (!schema(responseProperties.result)) throw new Error("The native RPC result schema is unavailable.");
  const error = definitions.JSONRPCError;
  const errorProperties = object(error) && object(error.properties) ? error.properties : {};
  if (!schema(errorProperties.error)) throw new Error("The native RPC error schema is unavailable.");
  return { id: operationId, name: method, description: typeof request.description === "string" ? request.description : "",
    group: "Client requests", method: "RPC", path: method, protocol: "json-rpc",
    rpc: { version: (scoped.info as { version: string }).version, method,
      paramsRequired: (request.required as string[]).includes("params"),
      ...(schema(properties.params) ? { params: properties.params } : {}), result: responseProperties.result, error: errorProperties.error },
    fields: [], bodyRequired: false, unavailableReason: codexExecutionLimitation };
}
