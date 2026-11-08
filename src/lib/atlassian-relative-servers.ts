// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./atlassian-relative-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import { ServerConfigurationRequiredError } from "./server-url.ts";
import type { Operation } from "./catalog.ts";
type Value = Record<string, any>;
export const atlassianRelativeSources = Object.fromEntries(Object.entries(data.sources).map(([id, source]) => [id, source.sha256]));
const profile = "atlassian-relative-v1";
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const connectName = "ConnectJWT";
const connectScheme = { type: "apiKey", in: "header", name: "Authorization",
  description: "The complete Authorization value: JWT <request-specific signed token>. Obtain it from your existing Connect app for this exact request and installed site. The provider validates its signature, query hash, permissions and expiry; tokens are not minted or refreshed here." };
function requireContract(valid: unknown, context: string): asserts valid {
  if (!valid) throw new Error(`Relative Atlassian routes require their reviewed native contract (${context}).`);
}
const variable = (name: string) => ({ default: `<${name}>`, description: `Configure the actual ${name} for the selected Atlassian account.` });
function server(url: string, slot: "site" | "cloudId") {
  return { url, variables: { [slot]: variable(slot) }, "x-operations-relative-atlassian": profile };
}
const connectContracts = new Map<string, { method: string; path: string }>(Object.entries(data.sources).flatMap(([catalog, source]) => Object.entries(source.operations)
  .filter(([, contract]) => catalog === "atlassian-app-migration" || catalog === "atlassian-confluence-v1" && contract.security === null)
  .map(([id, contract]) => [`${catalog}:${id}`, { method: contract.method, path: contract.path }] as const)));
export function requiresConnectJwt(operation: Pick<Operation, "id" | "method" | "path">): boolean {
  const contract = connectContracts.get(operation.id);
  return !!contract && operation.method === contract.method && operation.path === contract.path;
}
export function connectJwtOriginAllowed(operation: Pick<Operation, "id" | "method" | "path">, origin: string): boolean {
  if (!requiresConnectJwt(operation)) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/.test(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && (operation.id.startsWith("atlassian-app-migration:")
        ? /^\/(?:wiki\/)?rest\/atlassian-connect\/1\/migration\/?$/.test(url.pathname) : url.pathname === "/");
  } catch { return false; }
}
/** Reject traversal and encoded identifiers before URL parsing can hide them. */
export function validateAtlassianRelativeServer(value: Value): void {
  if (value["x-operations-relative-atlassian"] === undefined) return;
  const templates: Record<string, "site" | "cloudId"> = {
    "https://{site}.atlassian.net": "site",
    "https://api.atlassian.com/ex/confluence/{cloudId}": "cloudId",
    "https://{site}.atlassian.net/gateway/api/focus": "site",
    "https://api.atlassian.com/focus/cloud/{cloudId}": "cloudId",
    "https://{site}.atlassian.net/rest/atlassian-connect/1/migration": "site",
    "https://{site}.atlassian.net/wiki/rest/atlassian-connect/1/migration": "site",
  };
  const slot = typeof value.url === "string" && Object.hasOwn(templates, value.url) ? templates[value.url] : undefined;
  requireContract(value["x-operations-relative-atlassian"] === profile && slot
    && value.variables && Object.keys(value.variables).length === 1 && value.variables[slot], "server template");
  const definition = value.variables[slot], input = definition.default;
  requireContract(definition.enum === undefined || Array.isArray(definition.enum)
    && definition.enum.every((item: unknown) => typeof item === "string") && definition.enum.includes(input), "server variable enum");
  if (input === `<${slot}>` || input === "") throw new ServerConfigurationRequiredError(`Configure the Atlassian ${slot} before running this operation.`);
  if (typeof input !== "string" || input.length > (slot === "site" ? 63 : 128) || !(slot === "site" ? /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ : /^[A-Za-z0-9][A-Za-z0-9-]*$/).test(input))
    throw new Error(`The Atlassian ${slot} must be an explicit identifier without host suffixes, paths or encoded characters.`);
}
/** Qualify the complete source before mutating any routes or declarations. */
export function bindAtlassianRelativeServers(document: Value): void {
  const matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1, "identity");
  const [catalog, source] = matches[0]!;
  requireContract(sameSchemaValue(document.servers, source.servers) && sameSchemaValue(document.security ?? null, source.security)
    && sameSchemaValue(document.components?.securitySchemes ?? null, source.securitySchemes)
    && document["x-upstream-relative-atlassian"] === undefined, "servers and authentication");
  const contracts = source.operations as Record<string, Value>, seen = new Set<string>();
  const plans: { path: string; method: string; operation: Value; contract: Value }[] = [];
  for (const [path, item] of Object.entries(document.paths as Value)) {
    requireContract(item.servers === undefined && item.parameters === undefined, path);
    for (const [method, operation] of Object.entries(item as Value)) if (methods.has(method)) {
      const contract = contracts[operation.operationId];
      requireContract(contract && !seen.has(operation.operationId) && contract.path === path && contract.method === method.toUpperCase()
        && sameSchemaValue(operation.security ?? null, contract.security) && sameSchemaValue(operation.servers ?? null, contract.servers)
        && sameSchemaValue(operation.parameters ?? null, contract.parameters)
        && (!contract.requestBody || sameSchemaValue(operation.requestBody, contract.requestBody))
        && operation["x-upstream-relative-atlassian"] === undefined, operation.operationId);
      seen.add(operation.operationId); plans.push({ path, method, operation, contract });
    }
  }
  requireContract(seen.size === Object.keys(contracts).length, "inventory");
  if (catalog === "atlassian-confluence-v1") requireContract(sameSchemaValue(document.components?.schemas?.ConnectModules,
    data.sources["atlassian-confluence-v1"].connectModules), "ConnectModules");
  document["x-upstream-relative-atlassian"] = { servers: structuredClone(document.servers), security: document.security ?? null,
    securitySchemes: structuredClone(document.components?.securitySchemes ?? null) };
  if (catalog === "atlassian-focus") {
    document.servers = [server("https://{site}.atlassian.net/gateway/api/focus", "site"), server("https://api.atlassian.com/focus/cloud/{cloudId}", "cloudId")];
    const paths: Value = {};
    for (const [path, item] of Object.entries(document.paths as Value)) {
      requireContract(path.startsWith("/focus/v1/"), "Focus resource prefix");
      paths[path.slice("/focus".length)] = item;
    }
    document.paths = paths;
  } else if (catalog === "atlassian-confluence-v1") {
    document.servers = [server("https://{site}.atlassian.net", "site"), server("https://api.atlassian.com/ex/confluence/{cloudId}", "cloudId")];
    document.components.securitySchemes[connectName] = structuredClone(connectScheme);
    document["x-upstream-connect-modules-schema"] = document.components.schemas.ConnectModules;
    document.components.schemas.ConnectModules = { type: "object", additionalProperties: { type: "array", items: { type: "object", additionalProperties: true } },
      description: "Map from Connect module type to its module definitions, in the same format as the app descriptor modules property." };
  } else {
    document.servers = [server("https://{site}.atlassian.net/rest/atlassian-connect/1/migration", "site"), server("https://{site}.atlassian.net/wiki/rest/atlassian-connect/1/migration", "site")];
    document.components ??= {}; document.components.securitySchemes = { [connectName]: structuredClone(connectScheme) };
    document.security = [{ [connectName]: [] }];
  }
  for (const { path, operation, contract } of plans) {
    operation["x-upstream-relative-atlassian"] = { path, security: structuredClone(operation.security ?? null),
      parameters: structuredClone(operation.parameters ?? null), ...(contract.requestBody ? { requestBody: structuredClone(operation.requestBody) } : {}) };
    if (catalog === "atlassian-confluence-v1" && contract.security === null) operation.security = [{ [connectName]: [] }];
    if (catalog === "atlassian-app-migration" && path === "/data/{s3Key}") operation["x-operations-credential-result"] = true;
    const form = operation.requestBody?.content?.["multipart/form-data"];
    if (form) {
      const schema = form.schema; schema.type = "object";
      schema.properties.comment = { ...schema.properties.comment }; delete schema.properties.comment.format;
      schema.properties.minorEdit = { type: "boolean", default: false, description: schema.properties.minorEdit.description };
      form.encoding = { comment: { contentType: "text/plain; charset=utf-8" } };
      operation.parameters = [...operation.parameters, { in: "header", name: "X-Atlassian-Token", required: true,
        schema: { type: "string", enum: ["nocheck"], default: "nocheck" }, description: "Required native XSRF exemption for this attachment upload." }];
    }
    if (operation.requestBody?.content?.["*/*"]) operation.requestBody.content = { "application/json": operation.requestBody.content["*/*"] };
  }
}
