// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation, InputField, JsonValue } from "./catalog.ts";
import type { InputValues, PreparedRequest } from "./operation-input.ts";
import { sameSchemaValue } from "./schema-merge.ts";
import { validateWorkflowBinary, workflowBinaryBlob, maxWorkflowUploadBytes, type WorkflowBinary } from "./workflow-binary.ts";
const routes: Record<string, [string, string]> = {
  "google-gmail:gmail.users.drafts.create": ["POST", "/gmail/v1/users/{userId}/drafts"],
  "google-gmail:gmail.users.drafts.send": ["POST", "/gmail/v1/users/{userId}/drafts/send"],
  "google-gmail:gmail.users.drafts.update": ["PUT", "/gmail/v1/users/{userId}/drafts/{id}"],
  "google-gmail:gmail.users.messages.import": ["POST", "/gmail/v1/users/{userId}/messages/import"],
  "google-gmail:gmail.users.messages.insert": ["POST", "/gmail/v1/users/{userId}/messages"],
  "google-gmail:gmail.users.messages.send": ["POST", "/gmail/v1/users/{userId}/messages/send"],
};
export const gmailMessageProfile = "gmail-message-v1";
export const gmailMimeInputKey = "body:$mime";
export function requireGmailMessageRoute(operation: Pick<Operation, "id" | "method" | "path">, marker: unknown): void {
  const route = routes[operation.id];
  if (marker !== gmailMessageProfile || route?.[0] !== operation.method || route[1] !== operation.path)
    throw new Error("Gmail message bodies require their reviewed native ID, method and metadata path.");
}
export function configureGmailMessage(operation: Operation, marker: unknown): void {
  if (marker === undefined) return;
  requireGmailMessageRoute(operation, marker);
  const schema = operation.bodySchema;
  if (operation.bodyMediaType !== "application/json" || schema?.type !== "object" || operation.binaryMediaTypes || operation.multipartParts)
    throw new Error("Gmail messages require the native JSON resource and a separate MIME upload body.");
  operation.gmailMessage = gmailMessageProfile;
  operation.bodyValue = false; operation.bodyRequired = false;
  const resource: InputField = { key: "body:$", name: "$", label: "Message resource", location: "body", type: "object", required: false, schema,
    description: "Provide the JSON Draft or Message resource. Add a MIME file below to upload media with this metadata." };
  const mime: InputField = { key: gmailMimeInputKey, name: "$mime", label: "MIME message", location: "body", type: "string", format: "binary", required: false,
    description: "Upload exact message/* bytes, with optional JSON metadata above. Resumable sessions use a separate protocol.",
    schema: { type: "string", format: "binary", minLength: 1, maxLength: maxWorkflowUploadBytes } };
  operation.bodySchema = { type: "object", additionalProperties: false, required: [], properties: { $: schema, $mime: mime.schema! } };
  operation.fields = [...operation.fields.filter(field => field.location !== "body"), resource, mime];
}
export function validGmailMessage(operation: Operation): boolean {
  try { requireGmailMessageRoute(operation, operation.gmailMessage); } catch { return false; }
  const body = operation.fields.filter(field => field.location === "body"), resource = body.find(field => field.key === "body:$"), mime = body.find(field => field.key === gmailMimeInputKey);
  return operation.bodyMediaType === "application/json" && operation.bodySchema?.type === "object" && operation.bodyValue === false && operation.bodyRequired === false
    && !operation.binaryMediaTypes && !operation.multipartParts && body.length === 2 && resource?.type === "object" && resource.name === "$" && resource.required === false
    && sameSchemaValue(Object.keys(operation.bodySchema.properties ?? {}).sort(), ["$", "$mime"]) && operation.bodySchema.additionalProperties === false
    && sameSchemaValue(operation.bodySchema.required, []) && sameSchemaValue(resource.schema, operation.bodySchema.properties?.$)
    && mime?.type === "string" && mime.name === "$mime" && mime.format === "binary" && mime.required === false
    && sameSchemaValue(mime.schema, operation.bodySchema.properties?.$mime)
    && sameSchemaValue(mime.schema, { type: "string", format: "binary", minLength: 1, maxLength: maxWorkflowUploadBytes });
}
export type GmailMessageMode = { file?: WorkflowBinary };
export function gmailMessageMode(operation: Operation, values: InputValues): GmailMessageMode | undefined {
  if (operation.gmailMessage === undefined) return;
  if (!validGmailMessage(operation)) throw new Error("Gmail message body no longer matches its reviewed contract.");
  const supplied = (key: string) => values[key] === null || !!values[key]?.trim();
  const resource = supplied("body:$"), mime = supplied(gmailMimeInputKey);
  if (!resource && !mime) throw new Error("Provide the JSON Message resource, the MIME message file, or both.");
  if (Object.keys(values).some(key => key.startsWith("body:") && !["body:$", gmailMimeInputKey].includes(key) && values[key] !== undefined)
    || values["query:uploadType"] !== undefined) throw new Error("Gmail message metadata, upload type and MIME bytes cannot be overridden by extra fields.");
  if (!mime) return {};
  let file: WorkflowBinary;
  try { file = validateWorkflowBinary(JSON.parse(values[gmailMimeInputKey]!)); } catch { throw new Error("MIME message requires a valid binary workflow file."); }
  if (file.size === 0 || !file.mediaType.startsWith("message/")) throw new Error("MIME message requires nonempty message/* bytes.");
  return { file };
}
export function prepareGmailMessage(request: PreparedRequest, mode: GmailMessageMode | undefined): PreparedRequest {
  if (!mode) return request;
  const metadata = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body.$ : undefined;
  if (!mode.file) {
    if (metadata === undefined) throw new Error("Gmail message resource is missing.");
    return { ...request, body: metadata };
  }
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) throw new Error("Gmail upload metadata must be a JSON resource object.");
  return { ...request, path: "/upload" + request.path, query: { ...request.query, uploadType: metadata === undefined ? "media" : "multipart" },
    body: metadata === undefined ? mode.file : { metadata, file: mode.file },
    bodyFormat: metadata === undefined ? "binary" : "gmail-related", contentType: metadata === undefined ? mode.file.mediaType as `${string}/${string}` : "multipart/related" };
}
/** A related upload has metadata first and untouched message bytes second.
 * Blob owns the wire boundary so neither HTTP executor invents its header. */
export function gmailRelatedBody(body: JsonValue): Blob {
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))
    throw new Error("Gmail related uploads require metadata and a MIME file.");
  const file = validateWorkflowBinary(body.file), metadata = JSON.stringify(body.metadata), bytes = atob(file.base64);
  if (!file.size || !file.mediaType.startsWith("message/") || new TextEncoder().encode(metadata).length > maxWorkflowUploadBytes)
    throw new Error("Gmail related upload exceeds its metadata budget or has invalid message bytes.");
  let boundary = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = "operations-" + crypto.randomUUID();
    if (!metadata.includes(candidate) && !bytes.includes(candidate)) { boundary = candidate; break; }
  }
  if (!boundary) throw new Error("Could not create a collision-free Gmail upload boundary.");
  return new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.mediaType}\r\n\r\n`,
    workflowBinaryBlob(file), `\r\n--${boundary}--\r\n`], { type: `multipart/related; boundary=${boundary}` });
}
