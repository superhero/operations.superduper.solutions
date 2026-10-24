// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField, InputSchema, Operation } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { validateWorkflowBinary, workflowBinaryBlob } from "./workflow-binary.ts";

export const cloudflareOrigin = "https://api.cloudflare.com/client/v4";
export const cloudflareSessionField = "header:Authorization";
export const cloudflareUploadContracts = {
  "workers-session": ["POST", "/accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session"],
  "platform-session": ["POST", "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/assets-upload-session"],
  "workers-upload": ["POST", "/accounts/{account_id}/workers/assets/upload"],
  "workers-version": ["POST", "/accounts/{account_id}/workers/scripts/{script_name}/versions"],
  "workers-module": ["PUT", "/accounts/{account_id}/workers/scripts/{script_name}"],
  "platform-module": ["PUT", "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}"],
  "pages-session": ["GET", "/accounts/{account_id}/pages/projects/{project_name}/upload-token"],
  "pages-check": ["POST", "/pages/assets/check-missing"],
  "pages-upload": ["POST", "/pages/assets/upload"],
  "pages-complete": ["POST", "/pages/assets/upsert-hashes"],
} as const;
export type CloudflareUploadProfile = keyof typeof cloudflareUploadContracts;
export function cloudflareUploadProfile(value: unknown): CloudflareUploadProfile | undefined {
  if (value === undefined) return;
  if (typeof value === "string" && Object.hasOwn(cloudflareUploadContracts, value)) return value as CloudflareUploadProfile;
  throw new Error("This Cloudflare upload profile is not supported.");
}
export function uploadSessionConsumer(profile: CloudflareUploadProfile | undefined): boolean {
  return profile === "workers-upload" || !!profile?.startsWith("pages-") && profile !== "pages-session";
}
export function uploadCompletionConsumer(profile: CloudflareUploadProfile | undefined): boolean {
  return profile === "workers-version" || profile === "workers-module" || profile === "platform-module";
}
const field = (name: string, location: InputField["location"], schema: InputSchema, required = true, label = name): InputField =>
  ({ ...schema, key: `${location}:${name}`, name, label, description: "", location, required, schema });
const text: InputSchema = { type: "string", minLength: 1, maxLength: 128 };
const hashes: InputSchema = { type: "array", items: { type: "string", pattern: "^[a-f0-9]{32}$" }, maxItems: 1000 };
const files: InputSchema = { type: "object", additionalProperties: { type: "string", format: "binary" } };
const object = (properties: Record<string, InputSchema>, required = Object.keys(properties)): InputSchema =>
  ({ type: "object", properties, required, additionalProperties: false });

/** Reviewed logical inputs for protocols that cannot use generic form encoding.
 * Native paths/identities are preserved; the private transport owns their wire form. */
export function configureCloudflareUpload(operation: Operation, profile: CloudflareUploadProfile): void {
  const [method, path] = cloudflareUploadContracts[profile];
  if (operation.method !== method || operation.path !== path) throw new Error("Cloudflare uploads require the reviewed method and path.");
  operation.cloudflareUpload = profile;
  delete operation.bodySchema; delete operation.bodyValue; delete operation.bodyMediaType; delete operation.binaryMediaTypes;
  operation.fields = [...path.matchAll(/\{([^{}]+)\}/g)].map(match => field(match[1]!, "path", text));
  operation.bodyRequired = method !== "GET";
  operation.responseMediaType = "application/json";
  if (uploadSessionConsumer(profile)) operation.fields.push(field("Authorization", "header", { type: "string" }, false, "Private upload session"));
  let body: InputSchema | undefined;
  if (profile === "workers-session" || profile === "platform-session") body = object({ manifest: {
    type: "object", additionalProperties: object({ hash: { type: "string", pattern: "^[a-f0-9]{32}$" }, size: { type: "integer", minimum: 0, maximum: 500000 } }),
  } });
  else if (profile === "workers-upload") {
    operation.fields.push({ ...field("base64", "query", { type: "boolean", enum: [true] }), defaultValue: "true" });
    body = object({ files });
  } else if (uploadCompletionConsumer(profile)) body = object({
    metadata: { type: "object", properties: { main_module: text, assets: { type: "object", properties: { jwt: { type: "string" } }, required: ["jwt"], additionalProperties: true } },
      required: ["main_module", "assets"], additionalProperties: true }, files,
  });
  else if (profile === "pages-upload") {
    body = { type: "array", maxItems: 100, items: object({ key: { type: "string", pattern: "^[a-f0-9]{32}$" }, value: { type: "string" },
      base64: { type: "boolean", enum: [true] }, metadata: object({ contentType: { type: "string" } }) }) };
  } else if (profile === "pages-check" || profile === "pages-complete") body = object({ hashes });
  if (body) {
    operation.bodyMediaType = "application/json"; operation.bodySchema = body;
    if (body.type === "array") { operation.bodyValue = true; operation.fields.push(field("$", "body", body, true, "Files")); }
    else operation.fields.push(...Object.entries(body.properties!).map(([name, schema]) => field(name, "body", schema)));
  }
}

export function cloudflareMultipart(request: PreparedRequest): FormData {
  const body = request.body as { files: Record<string, unknown>; metadata?: unknown }, form = new FormData();
  const entries = Object.entries(body.files);
  if (!entries.length || entries.length > 100) throw new Error("Provide between 1 and 100 files.");
  if (request.bodyFormat === "cloudflare-module") form.append("metadata", new Blob([JSON.stringify(body.metadata)], { type: "application/json" }), "metadata.json");
  for (const [name, value] of entries) {
    if (!name || name.length > 256 || /[\r\n\u0000]/.test(name) || name === "metadata") throw new Error("Invalid upload part name.");
    const file = validateWorkflowBinary(value);
    if (request.bodyFormat === "cloudflare-assets") {
      if (!/^[a-f0-9]{32}$/.test(name)) throw new Error("An asset part must use its manifest hash.");
      form.append(name, new Blob([file.base64], { type: file.mediaType || "application/null" }), name);
    } else form.append(name, workflowBinaryBlob(file), name);
  }
  return form;
}
