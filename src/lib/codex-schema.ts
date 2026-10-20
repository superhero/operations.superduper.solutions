// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { CatalogGroup } from "./catalog-registry.ts";

type Value = Record<string, unknown>;
export const codexExecutionLimitation = "Codex App Server requires a JSON-RPC connector. Execution is not enabled yet.";
const object = (value: unknown): Value => value && typeof value === "object" && !Array.isArray(value) ? value as Value : {};

/** Recognize the native protocol bundle, without pretending its methods are HTTP endpoints. */
export function isCodexSchema(document: Value): boolean { return Object.hasOwn(document, "x-codex-app-server"); }

export function inspectCodexSchema(document: Value, id: string, selected?: ReadonlySet<string>)
  : { document: Value; operations: Operation[]; name: string; serverUrl: string; groups: CatalogGroup[] }
{
  const info = object(document.info);
  const protocol = object(document["x-codex-app-server"]);
  const definitions = object(document.definitions);
  const requests = object(definitions.ClientRequest).oneOf;
  if (document.openapi !== undefined || document.paths !== undefined
    || document.$schema !== "http://json-schema.org/draft-07/schema#"
    || protocol.protocol !== "json-rpc" || typeof info.title !== "string" || !info.title.trim()
    || typeof info.version !== "string" || !info.version.trim() || protocol.version !== info.version
    || !Array.isArray(requests) || !requests.length
    || !["ServerRequest", "ClientNotification", "ServerNotification", "JSONRPCResponse", "JSONRPCError"].every(key => Object.hasOwn(definitions, key)))
    throw new Error("Invalid Codex App Server schema: expected versioned native JSON-RPC request, response and event definitions.");
  const seen = new Set<string>();
  const operations: Operation[] = [];
  for (const request of requests)
  {
    const source = object(request);
    const properties = object(source.properties);
    const methods = object(properties.method).enum;
    if (!Array.isArray(methods) || methods.length !== 1 || typeof methods[0] !== "string"
      || !/^[A-Za-z][A-Za-z0-9_/-]*$/.test(methods[0]) || seen.has(methods[0])
      || !Array.isArray(source.required) || !source.required.includes("method") || !source.required.includes("id"))
      throw new Error("Invalid Codex App Server schema: client requests must have unique method names and request IDs.");
    const method = methods[0];
    seen.add(method);
    const identity = `${id}:${method}`;
    if (selected && !selected.has(identity)) continue;
    operations.push({ id: identity, name: method, description: typeof source.description === "string" ? source.description : "",
      group: "Client requests", method: "RPC", path: method, fields: [], bodyRequired: false,
      unavailableReason: codexExecutionLimitation });
  }
  return { document, operations, name: info.title.trim(), serverUrl: "",
    groups: [{ id, name: info.title.trim(), description: typeof info.description === "string" ? info.description : "",
      children: [{ id: `${id}:client-requests`, name: "Client requests", description: "", operationIds: operations.map(operation => operation.id) }] }] };
}
