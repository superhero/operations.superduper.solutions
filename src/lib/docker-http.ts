// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./docker-http-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import { ServerConfigurationRequiredError } from "./server-url.ts";
import type { Operation } from "./catalog.ts";
type Value = Record<string, any>;
export const dockerHttpSourceSha256 = data.source.sha256;
export const dockerHttpProfile = "docker-http-v1";
export const dockerAttachOperationId = "docker:ContainerAttachWebsocket";
export const dockerAttachPath = "/containers/{id}/attach/ws";
export const dockerProgressIds = ["ImageBuild", "ImageCreate", "ImagePush", "ImageLoad", "PluginPull", "PluginPush", "PluginUpgrade"];
const routes: Record<string, { method: string; path: string }> = data.routes;
const inputs: Record<string, string[]> = data.privateInputs;
const nested: Record<string, { key: string; path: string[] }[]> = data.privatePaths;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
function requireContract(valid: unknown, context: string): asserts valid {
  if (!valid) throw new Error(`Docker HTTP operations require their reviewed native contract (${context}).`);
}
export function dockerHttpOperation(operation: Pick<Operation, "id" | "method" | "path">): string | undefined {
  if (!operation.id.startsWith("docker:")) return;
  const id = operation.id.slice(7), contract = Object.hasOwn(routes, id) ? routes[id] : undefined;
  return contract?.method === operation.method && contract.path === operation.path ? id : undefined;
}
export function dockerHttpPrivateInputs(operation: Operation): string[] {
  const id = dockerHttpOperation(operation);
  return id ? [...inputs[id] ?? [], ...operation.fields.filter(field => field.location === "header"
    && ["x-registry-auth", "x-registry-config"].includes(field.name.toLowerCase())).map(field => field.key)] : [];
}
export function dockerHttpPrivatePaths(operation: Operation): { key: string; path: string[] }[] {
  const id = dockerHttpOperation(operation); return id ? structuredClone(nested[id] ?? []) : [];
}
export function hasDockerNestedPrivateInput(operation: Operation, values: Record<string, unknown>): boolean {
  return dockerHttpPrivatePaths(operation).some(slot => {
    let value: unknown;
    try { value = JSON.parse(String(values[slot.key] ?? "")); } catch { return false; }
    for (const part of slot.path) value = value && typeof value === "object" ? (value as Value)[part] : undefined;
    return value !== undefined && value !== null && value !== "";
  });
}
export function dockerHttpEndpoint(input: string): string {
  const url = new URL(input), canonical = url.href.replace(/\/$/, "");
  if (!/^(?:http:|https:)$/.test(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash
    || /[\\\u0000-\u0020\u007f]/.test(input) || input !== canonical && input !== canonical + "/"
    || !url.pathname.replace(/\/$/, "").endsWith("/v1.57") || url.pathname.includes("//")) throw new Error("Configure the complete Docker HTTP(S) endpoint, including its /v1.57 API base.");
  for (const segment of url.pathname.split("/")) {
    const decoded = decodeURIComponent(segment);
    if (decoded === "." || decoded === ".." || /[%\\/?#\u0000-\u0020\u007f]/.test(decoded)) throw new Error("Docker endpoint paths cannot contain traversal or encoded separators.");
  }
  return canonical;
}
export function validateDockerHttpServer(server: Value): void {
  if (server["x-operations-docker-server"] === undefined) return;
  requireContract(server["x-operations-docker-server"] === dockerHttpProfile && server.url === "{docker_endpoint}"
    && server.variables && Object.keys(server.variables).length === 1 && server.variables.docker_endpoint, "server template");
  const variable = server.variables.docker_endpoint, input = variable.default;
  requireContract(variable.enum === undefined || Array.isArray(variable.enum) && variable.enum.includes(input), "endpoint enum");
  if (input === "<docker_endpoint>" || input === "") throw new ServerConfigurationRequiredError("Configure a Docker HTTP endpoint before running this operation. Native reads require a separately paired Docker host.");
  if (typeof input !== "string") throw new Error("The Docker endpoint must be an absolute HTTP(S) URL.");
  dockerHttpEndpoint(input);
}
export function dockerLegacyJsonStream(operation: Operation, media: string | undefined): boolean {
  const id = dockerHttpOperation(operation);
  return !!id && media === "application/json" && (id === "SystemEvents" && operation.responseStream === "ndjson"
    || dockerProgressIds.includes(id) && operation.responseStream === "docker-progress");
}
export function dockerAttachParameters(): Value[] {
  return data.special.ContainerAttachWebsocket.parameters!.map(parameter => {
    const result = structuredClone(parameter) as Value;
    if (parameter.name === "stdin") result.schema = { ...result.schema, enum: [false] };
    if (parameter.name === "logs" || parameter.name === "stdout" || parameter.name === "stderr") result.schema.default = true;
    return result;
  });
}
/** Check the whole native inventory and each changed declaration before mutation. */
export function bindDockerHttp(document: Value): void {
  requireContract(document.openapi === data.source.openapi && document.info?.title === data.source.title
    && document.info?.version === data.source.version && sameSchemaValue(document.servers, data.source.servers)
    && document.security === undefined && document.components?.securitySchemes === undefined && document["x-upstream-docker-http"] === undefined, "identity");
  const seen = new Set<string>(), plans: { id: string; operation: Value }[] = [];
  for (const [path, item] of Object.entries(document.paths as Value)) {
    requireContract(item.servers === undefined, path);
    for (const [method, operation] of Object.entries(item as Value)) if (methods.has(method)) {
      const id = operation.operationId, contract = Object.hasOwn(routes, id) ? routes[id] : undefined;
      requireContract(contract && !seen.has(id) && contract.path === path && contract.method === method.toUpperCase()
        && operation.security === undefined && operation.servers === undefined && operation["x-upstream-docker-http"] === undefined, id);
      const special = (data.special as Value)[id];
      if (special) for (const key of ["parameters", "requestBody", "responses"])
        requireContract(sameSchemaValue(operation[key] ?? null, special[key]), `${id} ${key}`);
      seen.add(id); plans.push({ id, operation });
    }
  }
  requireContract(seen.size === Object.keys(routes).length, "inventory");
  for (const [name, schema] of Object.entries(data.schemas)) requireContract(sameSchemaValue(document.components.schemas[name], schema), name);
  document["x-upstream-docker-http"] = { servers: structuredClone(document.servers) };
  document.servers = [{ url: "{docker_endpoint}", variables: { docker_endpoint: { default: "<docker_endpoint>",
    description: "Complete operator-configured HTTP(S) server URL, including /v1.57. No daemon or socket is selected automatically." } }, "x-operations-docker-server": dockerHttpProfile }];
  for (const { id, operation } of plans) {
    if ((data.special as Value)[id]) operation["x-upstream-docker-http"] = structuredClone((data.special as Value)[id]);
    if (id === "ImageCreate") operation.requestBody.content = { "application/octet-stream": { schema: { type: "string", format: "binary" } } };
    if (data.registryHeaderAdditions.includes(id)) operation.parameters = [...operation.parameters ?? [], { name: "X-Registry-Auth", in: "header", required: false,
      description: "Base64url-encoded registry AuthConfig, supplied privately through Secrets.", schema: { type: "string" } }];
    if (["SystemAuth", "SwarmInspect", "SwarmUnlockkey"].includes(id)) {
      operation["x-operations-credential-result"] = true;
      operation.responses["200"].content = { "application/json": operation.responses["200"].content["application/json"] };
    }
    if (dockerProgressIds.includes(id) || id === "SystemEvents") {
      const content = operation.responses["200"]?.content;
      const schema = id === "SystemEvents" ? structuredClone(content["application/x-ndjson"].schema)
        : { type: "object", required: ["messages"], properties: { messages: { type: "array", items: { type: "object", additionalProperties: true } } } };
      operation.responses["200"] ??= { description: "Finite Docker JSON progress response." };
      operation.responses["200"].content = { "application/x-ndjson": { schema: { type: "string" } }, "application/json": { schema } };
      operation["x-operations-response-stream"] = id === "SystemEvents" ? "ndjson" : "docker-progress";
    }
    if (id === "ContainerAttachWebsocket") {
      operation.parameters = dockerAttachParameters(); operation["x-operations-docker-attach"] = "read-v1";
      for (const status of ["101", "200"]) operation.responses[status].content = { "application/octet-stream": { schema: { type: "string", format: "binary" } } };
    }
  }
}
