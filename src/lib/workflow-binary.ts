// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema, JsonValue } from "./catalog.ts";

export const maxWorkflowUploadBytes = 500_000;
export type WorkflowBinary = { kind: "workflow-file"; version: 1; name: string; mediaType: string; size: number; base64: string };
const mediaPattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const mediaTypes: Record<string, string> = { json: "application/json", csv: "text/csv", txt: "text/plain", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  zip: "application/zip", gz: "application/gzip", wasm: "application/wasm", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm" };

export function fileMediaType(name: string, provided = ""): string {
  const extension = name.split(".").at(-1)!.toLowerCase();
  return provided.length <= 255 && mediaPattern.test(provided) ? provided.toLowerCase()
    : Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension]! : "application/octet-stream";
}

/** A bounded JSON envelope keeps exact bytes in workflow history and exports. */
export function validateWorkflowBinary(value: unknown): WorkflowBinary {
  const file = value as WorkflowBinary | null;
  if (!file || file.kind !== "workflow-file" || file.version !== 1 || typeof file.name !== "string" || !file.name.trim()
    || file.name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(file.name) || typeof file.mediaType !== "string" || file.mediaType.length > 255 || !mediaPattern.test(file.mediaType)
    || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxWorkflowUploadBytes || typeof file.base64 !== "string"
    || file.base64.length > Math.ceil(maxWorkflowUploadBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
    throw new Error("Invalid binary workflow file.");
  const decoded = atob(file.base64);
  if (decoded.length !== file.size || btoa(decoded) !== file.base64) throw new Error("Invalid binary workflow file.");
  return { kind: "workflow-file", version: 1, name: file.name, mediaType: file.mediaType.toLowerCase(), size: file.size, base64: file.base64 };
}

export function encodeWorkflowBinary(name: string, bytes: Uint8Array, mediaType = ""): WorkflowBinary {
  if (bytes.byteLength > maxWorkflowUploadBytes) throw new Error("Files must be no larger than 500 kB.");
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return validateWorkflowBinary({ kind: "workflow-file", version: 1, name, mediaType: fileMediaType(name, mediaType), size: bytes.length, base64: btoa(chunks.join("")) });
}

export function workflowBinaryBlob(value: JsonValue, mediaType?: string): Blob {
  const file = validateWorkflowBinary(value);
  const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
  return new Blob([bytes], { type: mediaType ?? file.mediaType });
}

/** Match declared raw-file media types; octet-stream accepts any file type. */
export function binaryRequestMediaType(declared: string[], value: JsonValue): string {
  const file = validateWorkflowBinary(value);
  if (declared.some(type => type.toLowerCase() === file.mediaType || type.toLowerCase() === "application/octet-stream")) return file.mediaType;
  throw new Error(`This operation does not accept ${file.mediaType} files.`);
}

export function isBinaryMediaType(value: string): boolean {
  return value.length <= 255 && mediaPattern.test(value) && !["application/json", "application/x-www-form-urlencoded", "multipart/form-data"].includes(value.toLowerCase());
}

export function containsBinaryInput(schema: InputSchema): boolean {
  return schema.format === "binary" || Object.values(schema.properties ?? {}).some(containsBinaryInput)
    || !!schema.items && containsBinaryInput(schema.items)
    || typeof schema.additionalProperties === "object" && containsBinaryInput(schema.additionalProperties);
}
