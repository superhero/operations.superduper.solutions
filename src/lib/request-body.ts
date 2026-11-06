// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { cloudflareMultipart } from "./cloudflare-upload.ts";
import type { JsonValue } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { validateWorkflowBinary, workflowBinaryBlob } from "./workflow-binary.ts";
import { appendMultipartPart, multipartBody } from "./multipart-parts.ts";
import { gmailRelatedBody } from "./gmail-message.ts";

function formText(value: JsonValue): string {
  if (value === null) throw new Error("Explicit null has no qualified form encoding.");
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("Form text values must be strings, finite numbers or booleans.");
}

/** Both HTTP executors serialize the same validated request, without JSON-encoding files. */
export function requestBody(request: PreparedRequest): BodyInit | null {
  if (request.body === undefined) return null;
  if (request.bodyFormat === "text") {
    if (typeof request.body !== "string") throw new Error("A serialized text body must be a string.");
    return request.body;
  }
  if (request.bodyFormat === "cloudflare-assets" || request.bodyFormat === "cloudflare-module") return cloudflareMultipart(request);
  if (request.bodyFormat === "gmail-related") return gmailRelatedBody(request.body);
  if (request.bodyFormat === "binary") return workflowBinaryBlob(request.body, request.contentType);
  if (request.contentType === "text/plain") return String(request.body);
  if (request.contentType === "application/x-www-form-urlencoded" || request.contentType === "multipart/form-data") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("Form bodies require named fields, with no explicit null encoding.");
    const form = request.contentType === "multipart/form-data" ? new FormData() : new URLSearchParams();
    for (const [name, value] of Object.entries(request.body as Record<string, JsonValue>)) {
      if (form instanceof FormData && Object.hasOwn(request.multipartParts ?? {}, name)) {
        appendMultipartPart(form, name, value, request.multipartParts![name]!); continue;
      }
      if (form instanceof FormData && form.has(name)) throw new Error(`Form field ${JSON.stringify(name)} collides with another encoded field.`);
      if (Array.isArray(value)) {
        for (const item of value) {
          if (form instanceof FormData && item && typeof item === "object") {
            const file = validateWorkflowBinary(item);
            form.append(name, workflowBinaryBlob(file), file.name);
          } else form.append(name, formText(item));
        }
      } else if (form instanceof FormData && value && typeof value === "object") {
        const file = validateWorkflowBinary(value);
        form.append(name, workflowBinaryBlob(file), file.name);
      } else form.append(name, formText(value));
    }
    return form instanceof FormData ? multipartBody(form, request.multipartParts) : form;
  }
  // JSON is also YAML 1.2 flow syntax. Keep typed values and quoted strings,
  // without evaluating YAML tags or aliases; the declared Content-Type is retained.
  return JSON.stringify(request.body);
}
