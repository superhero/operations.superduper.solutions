// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./atlassian-file-parts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
type Value = Record<string, any>;
export const atlassianFileSources = Object.fromEntries(Object.entries(data.sources).map(([id, source]) => [id, source.sha256]));
const object = (value: unknown): value is Value => value !== null && typeof value === "object" && !Array.isArray(value);
function requireContract(value: unknown, context: string): asserts value {
  if (!value) throw new Error(`Atlassian file uploads require their reviewed native contract (${context}).`);
}

/** FilePart is a server-side Java abstraction, not six upload form fields.
 * Part names come from the shipped MultipartFormParam annotations. Only these
 * eight request bodies change; the shared Java schema and response docs stay. */
export function bindAtlassianFiles(document: Value): void {
  const matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1, "service identity");
  const [catalog, source] = matches[0]!;
  requireContract(sameSchemaValue(document.components?.schemas?.FilePart, source.filePart), "FilePart declaration");
  requireContract(sameSchemaValue(document.servers, source.servers), "server templates");
  requireContract(sameSchemaValue(document.components?.securitySchemes?.basic, source.basic), "basic authentication declaration");
  requireContract(document.security === undefined, "document authentication");
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(object(operation) && operation.operationId === contract.operationId
      && operation["x-upstream-atlassian-file-request"] === undefined && sameSchemaValue(operation.requestBody, contract.requestBody), id);
    requireContract(operation.servers === undefined, id + ": operation server");
    const nativeSecurity = operation["x-upstream-security"] ?? operation.security ?? null;
    requireContract(sameSchemaValue(nativeSecurity, contract.security), id + ": authentication");
    if (operation["x-upstream-security"] !== undefined) {
      requireContract(Array.isArray(contract.security), id + ": upstream authentication");
      requireContract(sameSchemaValue(operation.security, contract.security.map(option => Object.fromEntries(Object.keys(option).map(name => [name, []]))))
        && sameSchemaValue(operation["x-credential-permissions"], contract.security.map(option => "OAuth2" in option ? { OAuth2: option.OAuth2 } : {})), id + ": bearer permissions");
    }
    requireContract(operation.parameters === undefined || Array.isArray(operation.parameters), id + ": parameters");
    requireContract(!(operation.parameters ?? []).some((parameter: Value) => parameter?.in === "header" && String(parameter.name).toLowerCase() === "x-atlassian-token"), id + ": XSRF header");
    requireContract(!(operation.parameters ?? []).some((parameter: Value) => parameter?.in === "query" && parameter.name === "os_authType"), id + ": authentication query");
    return { operation, contract };
  });
  for (const { operation, contract } of plans) {
    operation["x-upstream-atlassian-file-request"] = { requestBody: structuredClone(operation.requestBody), parameters: structuredClone(operation.parameters ?? null), servers: structuredClone(document.servers), security: structuredClone(operation.security ?? null) };
    operation.requestBody = { ...structuredClone(operation.requestBody), required: true, content: {
      "multipart/form-data": { schema: { type: "object", required: [contract.part], additionalProperties: false,
        properties: { [contract.part]: { type: "string", format: "binary", description: contract.part === "avatar" ? "Avatar image to upload." : "SAML metadata file to parse." } } } },
    } };
    operation.parameters = [...(operation.parameters ?? []), { name: "X-Atlassian-Token", in: "header", required: true,
      description: "Atlassian's documented multipart upload XSRF header.", schema: { type: "string", enum: ["no-check"], default: "no-check" } }];
    // These two exports omit authentication despite requiring an authenticated
    // user. Reuse the existing, documented native basic scheme; Jira's declared
    // basic/OAuth alternatives remain intact.
    if (contract.security === null) operation.security = [{ basic: [] }];
    if (catalog === "bamboo") operation.parameters.push({ name: "os_authType", in: "query", required: true,
      description: "Bamboo requires this query parameter for HTTP basic authentication.", schema: { type: "string", enum: ["basic"], default: "basic" } });
    // Crowd's exported admin path already includes /rest. Keep its native
    // identity while avoiding a second /rest in the operation's base URL.
    if (catalog === "crowd-dc") operation.servers = source.servers.map(server => ({ ...structuredClone(server), url: server.url.replace(/\/rest\/?$/, "") }));
  }
}
