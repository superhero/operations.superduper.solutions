// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { JsonValue } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { validateWorkflowBinary, workflowBinaryBlob } from "./workflow-binary.ts";

/** Both HTTP executors serialize the same validated request, without JSON-encoding files. */
export function requestBody(request: PreparedRequest): BodyInit | null {
  if (request.body === undefined) return null;
  if (request.bodyFormat === "binary") return workflowBinaryBlob(request.body, request.contentType);
  if (request.contentType === "text/plain") return String(request.body);
  if (request.contentType === "application/x-www-form-urlencoded") return new URLSearchParams(request.body as Record<string, string>);
  if (request.contentType === "multipart/form-data") {
    const form = new FormData();
    for (const [name, value] of Object.entries(request.body as Record<string, JsonValue>)) {
      if (value && typeof value === "object") {
        const file = validateWorkflowBinary(value);
        form.append(name, workflowBinaryBlob(file), file.name);
      } else form.append(name, String(value));
    }
    return form;
  }
  return JSON.stringify(request.body);
}
