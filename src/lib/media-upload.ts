// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation, InputField, JsonValue } from "./catalog.ts";
import type { InputValues, PreparedRequest } from "./operation-input.ts";
import { uploadBodyContracts, googleMediaProfile, rawUploadProfile } from "./upload-body-contracts.ts";
import { sameSchemaValue } from "./schema-merge.ts";
import { validateWorkflowBinary, workflowBinaryBlob, maxWorkflowUploadBytes, type WorkflowBinary } from "./workflow-binary.ts";
export const mediaUploadInputKey = "body:$media";
function contract(operation: Operation, kind: string) {
  const found = uploadBodyContracts[operation.id];
  if (found?.kind !== kind || found.method !== operation.method || found.path !== operation.path)
    throw new Error("Media uploads require their reviewed native operation ID, method and path.");
  return found;
}
export function configureMediaUpload(operation: Operation, google: unknown, raw: unknown): void {
  if (raw !== undefined) {
    contract(operation, "binary");
    if (raw !== rawUploadProfile || operation.bodyMediaType !== "application/octet-stream" || operation.bodySchema?.format !== "binary")
      throw new Error("Raw uploads require their reviewed file representation.");
    operation.rawUpload = rawUploadProfile;
  }
  if (google === undefined) return;
  contract(operation, "google-media");
  const schema = operation.bodySchema;
  if (google !== googleMediaProfile || operation.bodyMediaType !== "application/json" || schema?.type !== "object"
    || operation.rawUpload || operation.binaryMediaTypes || operation.multipartParts)
    throw new Error("Google uploads require the complete JSON metadata resource and a separate media file.");
  operation.googleMedia = googleMediaProfile;
  operation.bodyValue = false; operation.bodyRequired = false;
  const metadata: InputField = { key: "body:$", name: "$", label: "Metadata", location: "body", type: "object", required: false, schema,
    description: "The complete native JSON resource. With a media file, this becomes the first multipart/related part." };
  const media: InputField = { key: mediaUploadInputKey, name: "$media", label: "Media file", location: "body", type: "string", format: "binary", required: false,
    description: "Exact media bytes, up to 500 kB. Provide metadata above, media, or both.",
    schema: { type: "string", format: "binary", maxLength: maxWorkflowUploadBytes } };
  operation.bodySchema = { type: "object", additionalProperties: false, required: [], properties: { $: schema, $media: media.schema! } };
  operation.fields = [...operation.fields.filter(field => field.location !== "body"
    && !(field.location === "query" && ["uploadType", "upload_protocol"].includes(field.name))), metadata, media];
}
export type MediaUploadMode = { profile: ReturnType<typeof contract>; file?: WorkflowBinary; multipart: boolean; reserved: [string, string][] };
export function validUploadModel(operation: Operation): boolean {
  if (operation.rawUpload !== undefined) {
    try { contract(operation, "binary"); } catch { return false; }
    return operation.rawUpload === rawUploadProfile && operation.googleMedia === undefined && operation.bodyValue === true
      && operation.bodyMediaType === "application/octet-stream" && operation.bodySchema?.type === "string"
      && operation.bodySchema.format === "binary" && operation.bodySchema.maxLength === maxWorkflowUploadBytes
      && sameSchemaValue(operation.binaryMediaTypes, ["application/octet-stream"]);
  }
  if (operation.googleMedia === undefined) return false;
  try { contract(operation, "google-media"); } catch { return false; }
  const fields = operation.fields.filter(field => field.location === "body");
  const metadata = fields.find(field => field.key === "body:$"), media = fields.find(field => field.key === mediaUploadInputKey);
  if (operation.googleMedia !== googleMediaProfile || operation.bodyMediaType !== "application/json" || operation.bodyValue !== false
    || operation.bodyRequired !== false || fields.length !== 2 || metadata?.name !== "$" || metadata.type !== "object" || metadata.required
    || media?.name !== "$media" || media.type !== "string" || media.required || media.format !== "binary"
    || operation.bodySchema?.additionalProperties !== false || !sameSchemaValue(operation.bodySchema.required, [])
    || !sameSchemaValue(Object.keys(operation.bodySchema.properties ?? {}).sort(), ["$", "$media"])
    || !sameSchemaValue(metadata.schema, operation.bodySchema.properties?.$) || !sameSchemaValue(media.schema, operation.bodySchema.properties?.$media)
    || !sameSchemaValue(media.schema, { type: "string", format: "binary", maxLength: maxWorkflowUploadBytes }))
    return false;
  return true;
}
export function mediaUploadMode(operation: Operation, values: InputValues): MediaUploadMode | undefined {
  if (operation.googleMedia === undefined) return;
  if (!validUploadModel(operation)) throw new Error("Google upload fields no longer match their reviewed metadata and media contract.");
  const profile = contract(operation, "google-media");
  const hasMetadata = values["body:$"] === null || !!values["body:$"]?.trim();
  const hasMedia = values[mediaUploadInputKey] === null || !!values[mediaUploadInputKey]?.trim();
  if (!hasMetadata && !hasMedia) throw new Error("Provide the native JSON metadata resource, a media file, or both.");
  if (Object.keys(values).some(key => key.startsWith("body:") && !["body:$", mediaUploadInputKey].includes(key) && values[key] !== undefined))
    throw new Error("Google upload body fields must belong to the metadata resource or media file.");
  const file = hasMedia ? validateWorkflowBinary(JSON.parse(values[mediaUploadInputKey]!)) : undefined;
  const requested = values["query:uploadType"], alias = values["query:upload_protocol"];
  if (requested !== undefined && !["media", "multipart"].includes(requested ?? "") || alias !== undefined)
    throw new Error("uploadType supports media or multipart for bounded uploads; resumable sessions require their own transfer protocol.");
  const multipart = !!file && (hasMetadata || requested === "multipart");
  if (requested && (!file || requested !== (multipart ? "multipart" : "media"))) throw new Error("uploadType does not match the supplied metadata and media.");
  const reserved: [string, string][] = [];
  for (const match of profile.discovery.path.matchAll(/\{\+([^}]+)\}/g)) {
    const name = match[1]!, value = values[`path:${name}`];
    if (typeof value !== "string" || value.split("/").some(segment => !segment || segment === "." || segment === ".." || /[\\\x00-\x1f\x7f]/.test(segment)
      || /%(?:2e|2f|5c)/i.test(segment))) throw new Error(`Path parameter ${JSON.stringify(name)} requires a safe resource name.`);
    reserved.push([encodeURIComponent(value), value.split("/").map(encodeURIComponent).join("/")]);
  }
  return { profile, ...(file ? { file } : {}), multipart, reserved };
}
function allowedMedia(type: string, accepted: string[]): boolean {
  return accepted.some(value => value === "*/*" || value === type || value.endsWith("/*") && type.startsWith(value.slice(0, -1)));
}
export function prepareMediaUpload(operation: Operation, request: PreparedRequest, mode: MediaUploadMode | undefined): PreparedRequest {
  if (operation.rawUpload !== undefined) {
    const profile = contract(operation, "binary");
    if (!validUploadModel(operation)) throw new Error("Raw upload no longer matches its reviewed file model.");
    if (request.body === undefined && !operation.bodyRequired) return request;
    const file = validateWorkflowBinary(request.body);
    if (request.bodyFormat !== "binary"
      || !profile.contentType && !allowedMedia(file.mediaType, profile.acceptedMediaTypes)) throw new Error("Raw upload does not match its reviewed media contract.");
    return { ...request, query: { ...request.query, ...(profile.operationId === "app.bsky.video.uploadVideo" && request.query.name === undefined ? { name: file.name } : {}) },
      contentType: (profile.contentType ?? file.mediaType) as `${string}/${string}` };
  }
  if (!mode) return request;
  const metadata = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body.$ : undefined;
  let path = "/" + mode.profile.discovery.servicePath + request.path.replace(/^\//, "");
  for (const [encoded, expanded] of mode.reserved) path = path.replace(encoded, expanded);
  if (!mode.file) {
    if (metadata === undefined) throw new Error("Google upload metadata is missing.");
    return { ...request, path, body: metadata };
  }
  const accepted = mode.profile.discovery.mediaUpload.accept as string[];
  const type = allowedMedia(mode.file.mediaType, accepted) ? mode.file.mediaType : accepted.includes("application/octet-stream") ? "application/octet-stream" : undefined;
  if (!type) throw new Error("The media file Content-Type is not accepted by this Google upload.");
  const file = { ...mode.file, mediaType: type };
  return { ...request, path: "/upload" + path, query: { ...request.query, uploadType: mode.multipart ? "multipart" : "media" },
    body: mode.multipart ? { metadata: metadata ?? {}, file } : file,
    bodyFormat: mode.multipart ? "google-related" : "binary", contentType: mode.multipart ? "multipart/related" : type as `${string}/${string}` };
}
export function googleRelatedBody(body: JsonValue): Blob {
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))
    throw new Error("Google related uploads require JSON metadata and a binary file.");
  const file = validateWorkflowBinary(body.file), metadata = JSON.stringify(body.metadata), bytes = atob(file.base64);
  if (new TextEncoder().encode(metadata).length > maxWorkflowUploadBytes) throw new Error("Google upload metadata exceeds its 500 kB budget.");
  let boundary = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = "operations-" + crypto.randomUUID();
    if (!metadata.includes(candidate) && !bytes.includes(candidate)) { boundary = candidate; break; }
  }
  if (!boundary) throw new Error("Could not create a collision-free Google upload boundary.");
  return new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.mediaType}\r\n\r\n`,
    workflowBinaryBlob(file), `\r\n--${boundary}--\r\n`], { type: `multipart/related; boundary=${boundary}` });
}
