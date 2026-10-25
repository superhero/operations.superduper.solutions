// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { cloudflareMultipart } from "./cloudflare-upload.ts";
import type { JsonValue } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { validateWorkflowBinary, workflowBinaryBlob } from "./workflow-binary.ts";

function formText(value: JsonValue): string {
  if (value === null) throw new Error("Explicit null has no qualified form encoding.");
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("Form text values must be strings, finite numbers or booleans.");
}

/** Both HTTP executors serialize the same validated request, without JSON-encoding files. */
export function requestBody(request: PreparedRequest): BodyInit | null {
  if (request.body === undefined) return null;
  if (request.bodyFormat === "cloudflare-assets" || request.bodyFormat === "cloudflare-module") return cloudflareMultipart(request);
  if (request.bodyFormat === "binary") return workflowBinaryBlob(request.body, request.contentType);
  if (request.contentType === "text/plain") return String(request.body);
  if (request.contentType === "application/x-www-form-urlencoded" || request.contentType === "multipart/form-data") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("Form bodies require named fields, with no explicit null encoding.");
    const form = request.contentType === "multipart/form-data" ? new FormData() : new URLSearchParams();
    for (const [name, value] of Object.entries(request.body as Record<string, JsonValue>)) {
      if (Array.isArray(value)) {
        for (const item of value) form.append(name, formText(item));
      } else if (form instanceof FormData && value && typeof value === "object") {
        const file = validateWorkflowBinary(value);
        form.append(name, workflowBinaryBlob(file), file.name);
      } else form.append(name, formText(value));
    }
    return form;
  }
  return JSON.stringify(request.body);
}
