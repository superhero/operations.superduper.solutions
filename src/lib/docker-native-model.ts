// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField, InputSchema, Operation } from "./catalog.ts";
import { dockerNativeApi, dockerNativeOperationId, dockerNativeProfile } from "./docker-native-contract.ts";
import { withOperationCapabilities } from "./operation-capabilities.ts";
import { dockerAttachOperationId, dockerAttachPath, dockerAttachParameters } from "./docker-http.ts";
import { sameSchemaValue } from "./schema-merge.ts";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};

/** Explicit read transports retain native identities without inventing a server URL. */
export function dockerNativeReadOperation(document: ObjectValue, base: Pick<Operation, "id" | "method" | "path">): Operation | undefined {
  const info = object(document.info), path = object(object(document.paths)[base.path]), source = object(path.get);
  if (base.id === dockerAttachOperationId) {
    if (base.method !== "GET" || base.path !== dockerAttachPath || info.version !== dockerNativeApi || info.title !== "Docker Engine API"
      || source.operationId !== "ContainerAttachWebsocket" || source["x-operations-docker-attach"] !== "read-v1"
      || source.requestBody !== undefined || path.parameters !== undefined
      || [document.security, path.security, source.security].some(value => value !== undefined && (!Array.isArray(value) || value.length))
      || ["x-operations-credential-result", "x-operations-private-path", "x-operations-cloudflare-upload", "x-operations-response-stream"].some(key => source[key] !== undefined)
      || !sameSchemaValue(source.parameters, dockerAttachParameters())) return;
    for (const status of ["101", "200"]) if (!sameSchemaValue(object(object(source.responses)[status]).content,
      { "application/octet-stream": { schema: { type: "string", format: "binary" } } })) return;
    const fields = dockerAttachParameters().map(parameter => ({ key: parameter.in + ":" + parameter.name, name: parameter.name,
      label: parameter.name, description: parameter.description, location: parameter.in, required: parameter.required === true,
      type: parameter.schema.type, schema: structuredClone(parameter.schema),
      ...(parameter.schema.default !== undefined ? { defaultValue: JSON.stringify(parameter.schema.default) } : {}) })) as InputField[];
    return withOperationCapabilities({ id: base.id, method: "GET", path: base.path, group: "Container", name: String(source.summary ?? "Read container attachment"),
      description: String(source.description ?? ""), fields, bodyRequired: false, responseMediaType: "application/octet-stream",
      responseContent: { "101": { "application/octet-stream": "binary" }, "200": { "application/octet-stream": "binary" } },
      dockerNative: { profile: dockerNativeProfile, apiVersion: dockerNativeApi } });
  }
  const response = object(object(object(object(source.responses)["200"]).content)["application/json"]);
  if (base.id !== dockerNativeOperationId || base.method !== "GET" || base.path !== "/containers/json" || info.version !== dockerNativeApi
    || info.title !== "Docker Engine API" || source.operationId !== "ContainerList" || source.requestBody !== undefined || path.parameters !== undefined
    || ["x-operations-credential-result", "x-operations-private-path", "x-operations-cloudflare-upload", "x-operations-response-stream"].some(key => source[key] !== undefined)
    || [document.security, path.security, source.security].some(value => value !== undefined && (!Array.isArray(value) || value.length))
    || !Array.isArray(source.parameters) || source.parameters.length !== 4 || object(response.schema).type !== "array") return;
  const expected: Record<string, InputSchema["type"]> = { all: "boolean", limit: "integer", size: "boolean", filters: "string" }, names = new Set<string>();
  const fields: InputField[] = [];
  for (const raw of source.parameters) {
    const parameter = object(raw), schema = object(parameter.schema), name = parameter.name;
    if (typeof name !== "string" || !Object.hasOwn(expected, name) || names.has(name) || parameter.in !== "query" || parameter.required === true
      || parameter.content !== undefined || parameter.style !== undefined && parameter.style !== "form"
      || parameter.explode !== undefined && parameter.explode !== true || schema.type !== expected[name]
      || Object.keys(schema).some(key => !["type", "default", "description", "minimum", "maximum", "minLength", "maxLength", "pattern", "nullable", "enum", "example", "deprecated"].includes(key))) return;
    names.add(name);
    fields.push({ key: "query:" + name, name, label: name[0]!.toUpperCase() + name.slice(1),
      description: typeof parameter.description === "string" ? parameter.description : "", location: "query", required: false,
      type: expected[name]!, schema: structuredClone(schema) as InputSchema,
      ...(schema.default !== undefined ? { defaultValue: typeof schema.default === "string" ? schema.default : JSON.stringify(schema.default) } : {}) });
  }
  return withOperationCapabilities({ id: base.id, method: "GET", path: base.path, group: Array.isArray(source.tags) && typeof source.tags[0] === "string" ? source.tags[0] : "Operations",
    name: typeof source.summary === "string" ? source.summary : "List containers", description: typeof source.description === "string" ? source.description : "",
    fields, bodyRequired: false, responseMediaType: "application/json", dockerNative: { profile: dockerNativeProfile, apiVersion: dockerNativeApi } });
}
