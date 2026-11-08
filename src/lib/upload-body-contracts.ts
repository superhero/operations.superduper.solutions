// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import source from "./upload-body-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import { maxWorkflowUploadBytes } from "./workflow-binary.ts";
type Value = Record<string, any>;
export const uploadBodySources = source.sources as Record<string, Value>;
export const uploadBodyContracts = source.operations as Record<string, Value>;
export const googleMediaProfile = "google-media-v1";
export const rawUploadProfile = "raw-upload-v1";
const nativeMediaTypes = new Map([["json", "application/json"], ["text", "text/plain"],
  ["multipart", "multipart/form-data"], ["form", "application/x-www-form-urlencoded"]]);
const object = (value: unknown): value is Value => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(value: unknown, context = "source identity"): asserts value {
  if (!value) throw new Error(`Upload request bodies require their reviewed native declaration and provider wire contract: ${context}.`);
}
/** This adapter is applied before other catalog corrections. Preserve native
 * declarations; never reinterpret arbitrary wildcard or binary request bodies. */
export function bindUploadBodies(document: Value): void {
  const sources = Object.entries(uploadBodySources).filter(([, contract]) => document.openapi === contract.openapi
    && sameSchemaValue(document.info, contract.info) && sameSchemaValue(document.servers ?? null, contract.servers));
  requireContract(sources.length === 1);
  const catalog = sources[0]![0];
  const plans = Object.entries(uploadBodyContracts).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const item = document.paths?.[contract.path], operation = item?.[contract.method.toLowerCase()];
    requireContract(object(operation) && id === `${catalog}:${operation.operationId}` && operation.operationId === contract.operationId
      && sameSchemaValue(operation.servers ?? null, contract.servers) && sameSchemaValue(item.servers ?? null, contract.pathServers)
      && sameSchemaValue(operation.requestBody, contract.requestBody) && operation["x-upstream-upload-body"] === undefined
      && operation["x-operations-google-media"] === undefined && operation["x-operations-raw-upload"] === undefined);
    const declarations = Object.values(contract.requestBody.content) as Value[];
    requireContract(declarations.length > 0 && declarations.every(value => sameSchemaValue(value.schema, declarations[0]!.schema)));
    if (contract.schemaRef) requireContract(sameSchemaValue(document.components?.schemas?.[contract.schemaRef.split("/").at(-1)], contract.schema));
    requireContract(contract.kind !== "pending-filter-columns");
    if (id === "bluesky-app:app.bsky.video.uploadVideo") requireContract(sameSchemaValue(operation.security, [{ Bearer: [] }])
      && operation.parameters === undefined && document.components?.securitySchemes?.BlueskyVideoServiceAuth === undefined
      && operation["x-upstream-video-upload"] === undefined);
    if (contract.kind === "multipart" || catalog === "jira") requireContract(operation["x-upstream-upload-parameters"] === undefined
      && (operation.parameters === undefined || Array.isArray(operation.parameters))
      && !(operation.parameters ?? []).some((parameter: Value) => parameter.in === "header" && parameter.name?.toLowerCase() === "x-atlassian-token"));
    if (contract.pathParameter) {
      const binding = contract.pathParameter, parameters = document.paths?.[binding.sourcePath]?.[binding.sourceMethod]?.parameters;
      requireContract(sameSchemaValue(operation.parameters ?? null, binding.originalParameters)
        && operation["x-upstream-upload-parameters"] === undefined && Array.isArray(parameters)
        && parameters.filter((parameter: Value) => sameSchemaValue(parameter, binding.parameter)).length === 1
        && binding.parameter.name === "projectKey" && binding.parameter.in === "path" && binding.parameter.required === true,
        `${id} projectKey path binding`);
    }
    if (contract.kind === "google-media") {
      const discovery = contract.discovery;
      requireContract(discovery.httpMethod === contract.method && discovery.mediaUpload?.protocols?.simple?.multipart === true);
      const nativePath = new URL(uploadBodySources[catalog]!.servers[0].url).pathname.replace(/\/$/, "") + contract.path;
      requireContract(nativePath === "/" + discovery.servicePath + discovery.path.replaceAll("{+", "{")
        && discovery.mediaUpload.protocols.simple.path.replaceAll("{+", "{") === "/upload" + nativePath, `${id} metadata/upload paths`);
    }
    return { operation, contract, declaration: declarations[0]! };
  });
  for (const { operation, contract, declaration } of plans) {
    operation["x-upstream-upload-body"] = structuredClone(operation.requestBody);
    if (contract.pathParameter) {
      operation["x-upstream-upload-parameters"] = structuredClone(operation.parameters ?? null);
      operation.parameters = [...(operation.parameters ?? []), structuredClone(contract.pathParameter.parameter)];
    }
    if (contract.kind === "multipart" || contract.catalog === "jira") {
      operation["x-upstream-upload-parameters"] = structuredClone(operation.parameters ?? null);
      operation.parameters = [...(operation.parameters ?? []), { name: "X-Atlassian-Token", in: "header", required: true,
        description: "The documented Atlassian upload XSRF header.", schema: { type: "string", enum: ["no-check"], default: "no-check" } }];
    }
    if (contract.kind === "google-media") {
      operation["x-operations-google-media"] = googleMediaProfile;
      operation.servers = [{ url: contract.discovery.rootUrl.replace(/\/$/, "") }];
      operation.requestBody = { ...operation.requestBody, content: { "application/json": structuredClone(declaration) } };
    } else if (contract.kind === "binary") {
      operation["x-operations-raw-upload"] = rawUploadProfile;
      operation.requestBody = { ...operation.requestBody, content: { "application/octet-stream": {
        schema: { type: "string", format: "binary", maxLength: maxWorkflowUploadBytes },
      } } };
      if (contract.operationId === "app.bsky.video.uploadVideo") {
        operation["x-upstream-video-upload"] = { servers: structuredClone(operation.servers), security: structuredClone(operation.security) };
        operation.servers = [{ url: "https://video.bsky.app" }];
        document.components.securitySchemes.BlueskyVideoServiceAuth = { type: "http", scheme: "bearer", bearerFormat: "JWT",
          description: "Service-auth token from the account PDS, delegated for com.atproto.repo.uploadBlob with the PDS DID as audience. Use an integer expiry. The account accessJwt is not a video service token." };
        operation.security = [{ BlueskyVideoServiceAuth: [] }];
        operation.parameters = [
          { in: "query", name: "did", required: true, schema: { type: "string", pattern: "^did:[a-z]+:[^\\s/?#]+$" }, description: "The uploading account DID." },
          { in: "query", name: "name", schema: { type: "string", minLength: 1, maxLength: 255 }, description: "Upload filename; defaults to the selected media filename." },
        ];
      }
    } else {
      const media = nativeMediaTypes.get(contract.kind);
      requireContract(media);
      operation.requestBody = { ...operation.requestBody, content: { [media]: { ...structuredClone(declaration),
        ...(contract.kind === "multipart" ? { encoding: { content: { contentType: "text/plain" } } } : {}) } } };
    }
  }
}
