// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./digitalocean-destinations.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import type { Operation } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
type Value = Record<string, any>;
export const digitalOceanDestinationSourceSha256 = data.source.sha256;
export const digitalOceanUploadProfile = "digitalocean-upload";
export const digitalOceanUploadIssuer = "https://inference.do-ai.run";
export const digitalOceanUploadId = "digitalocean:inference_upload_batch_file";
export const digitalOceanUploadPath = "/<upload_url>";
export const digitalOceanSignedTypeKey = "header:Content-Type";
export const digitalOceanUploadServer = { url: "{upload_origin}",
  description: "Configure the upload_origin returned by the file intent. The complete signed URL stays in Secrets.",
  variables: { upload_origin: { default: "<upload_origin>", description: "Storage origin only, without the signed path or query." } } };
const signedType = { name: "Content-Type", in: "header", required: false,
  description: "The exact media type expected by the signed URL. The native API recommends application/octet-stream; its Go SDK uses application/x-ndjson.",
  schema: { type: "string", default: "application/octet-stream", maxLength: 255, pattern: "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$" } };
function requireContract(value: unknown, context: string): asserts value {
  if (!value) throw new Error(`DigitalOcean destination contract ${context} does not match its reviewed native source.`);
}
export function bindDigitalOceanDestinations(document: Value): void {
  requireContract(document.openapi === data.source.openapi && sameSchemaValue(document.info, data.source.info)
    && sameSchemaValue(document.servers, data.source.servers), "identity");
  const plans = Object.entries(data.operations).map(([id, c]) => {
    const item = document.paths?.[c.path], operation = item?.[c.method.toLowerCase()];
    requireContract(operation?.operationId === id && sameSchemaValue(item.servers ?? null, c.pathServers), id);
    for (const key of ["servers", "security", "parameters", "requestBody", "responses"] as const)
      requireContract(sameSchemaValue(operation[key] ?? null, c[key]), `${id} ${key}`);
    requireContract(operation["x-upstream-digitalocean-destination"] === undefined && operation["x-operations-private-path"] === undefined
      && operation["x-operations-credential-result"] === undefined && operation["x-operations-response-stream"] === undefined, `${id} provenance`);
    return { id, operation };
  });
  for (const { id, operation } of plans) {
    operation["x-upstream-digitalocean-destination"] = { servers: structuredClone(operation.servers), parameters: structuredClone(operation.parameters ?? null),
      privatePath: operation["x-operations-private-path"] ?? null, credentialResult: operation["x-operations-credential-result"] ?? null };
    if (id === "inference_upload_batch_file") {
      operation["x-operations-private-path"] = digitalOceanUploadProfile;
      operation.servers = [structuredClone(digitalOceanUploadServer)];
      operation.parameters = [structuredClone(signedType)];
    } else if (id === "inference_create_batch_file") operation["x-operations-credential-result"] = true;
    else {
      operation.parameters = operation.parameters.map((parameter: Value) => ({ ...parameter, schema: { ...parameter.schema, enum: [true] } }));
      operation["x-operations-response-stream"] = "openai-chat";
    }
  }
}
/** A public storage origin can be configured without publishing its signed URL. */
export function validateDigitalOceanUploadSource(document: Value, source: Value, item: Value = {}): void {
  if (source["x-operations-private-path"] !== digitalOceanUploadProfile) return;
  const c = data.operations.inference_upload_batch_file;
  const defaultOrigin = source.servers?.[0]?.variables?.upload_origin?.default;
  const server = structuredClone(digitalOceanUploadServer);
  requireContract(typeof defaultOrigin === "string", "upload origin variable");
  server.variables.upload_origin.default = defaultOrigin;
  requireContract(document.openapi === data.source.openapi && document.info?.title === data.source.info.title
    && document.info?.version === data.source.info.version && source.operationId === "inference_upload_batch_file"
    && sameSchemaValue(document.paths?.[digitalOceanUploadPath]?.put, source)
    && sameSchemaValue(document.servers, data.source.servers) && item.servers === undefined
    && sameSchemaValue(source.servers, [server]) && sameSchemaValue(source.security, [])
    && sameSchemaValue(source.requestBody, c.requestBody) && sameSchemaValue(source.parameters, [signedType]), "private upload");
}
export function digitalOceanStorageOrigin(input: string): string {
  const url = new URL(input);
  const storage = /^(?:[a-z0-9][a-z0-9.-]*\.)?[a-z0-9-]+\.digitaloceanspaces\.com$/i.test(url.hostname)
    || /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-](?:dualstack\.)?[a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/i.test(url.hostname);
  if (!storage || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.search || url.pathname !== "/"
    || input !== url.origin && input !== url.origin + "/") throw new Error("Configure the storage origin returned by the DigitalOcean file intent.");
  return url.origin;
}
export function validDigitalOceanUpload(operation: Operation): boolean {
  return operation.id === digitalOceanUploadId && operation.method === "PUT" && operation.path === digitalOceanUploadPath
    && operation.privatePath === digitalOceanUploadProfile && operation.bodyValue === true && operation.bodyRequired === true
    && operation.bodySchema?.type === "string" && operation.bodySchema.format === "binary"
    && operation.bodyMediaType === "application/octet-stream" && sameSchemaValue(operation.binaryMediaTypes, ["application/octet-stream"])
    && operation.fields.length === 2 && operation.fields.some(field => field.key === "body:$" && field.format === "binary")
    && operation.fields.some(field => field.key === digitalOceanSignedTypeKey && field.name === "Content-Type" && field.location === "header" && field.type === "string")
    && operation.responseStream === undefined;
}
/** OpenAI-compatible agent streaming is opt-in; preserve the native false default. */
export function prepareDigitalOceanAgent(operation: Operation, request: PreparedRequest): PreparedRequest {
  if (operation.id !== "digitalocean:agentInference_create_chat_completion") return request;
  if (operation.method !== "POST" || operation.path !== "/api/v1/chat/completions" || operation.responseStream !== "openai-chat"
    || !request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("DigitalOcean agent request does not match its reviewed JSON/stream contract.");
  return request.body.stream === undefined ? { ...request, body: { ...request.body, stream: false } } : request;
}
