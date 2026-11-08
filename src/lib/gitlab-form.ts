// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation, InputSchema } from "./catalog.ts";
import type { InputValues } from "./operation-input.ts";
const routes: Record<string, readonly string[]> = {
  "gitlab:postApiV4Groups": [
    "POST",
    "/api/v4/groups"
  ],
  "gitlab:postApiV4Projects": [
    "POST",
    "/api/v4/projects"
  ],
  "gitlab:postApiV4ProjectsImport": [
    "POST",
    "/api/v4/projects/import"
  ],
  "gitlab:postApiV4ProjectsRemoteImport": [
    "POST",
    "/api/v4/projects/remote-import"
  ],
  "gitlab:postApiV4ProjectsRemoteImportS3": [
    "POST",
    "/api/v4/projects/remote-import-s3"
  ],
  "gitlab:postApiV4ProjectsUserUserId": [
    "POST",
    "/api/v4/projects/user/{user_id}"
  ],
  "gitlab:putApiV4GroupsId": [
    "PUT",
    "/api/v4/groups/{id}"
  ],
  "gitlab:putApiV4ProjectsId": [
    "PUT",
    "/api/v4/projects/{id}"
  ]
};
export const gitlabJsonFormProfile = "gitlab-json-or-multipart-v1";
export function validGitlabJsonForm(operation: Operation): boolean {
  const route = routes[operation.id];
  return operation.bodyEncoding === gitlabJsonFormProfile && route?.[0] === operation.method && route[1] === operation.path
    && operation.bodyMediaType === "multipart/form-data" && operation.bodySchema?.type === "object" && !operation.bodyValue;
}
export function configureGitlabJsonForm(operation: Operation, marker: unknown): void {
  if (marker === undefined) return;
  if (marker !== gitlabJsonFormProfile) throw new Error("Unknown GitLab request body encoding.");
  operation.bodyEncoding = marker;
  if (!validGitlabJsonForm(operation)) throw new Error("GitLab request encoding requires its reviewed native route and multipart schema.");
}
export function useGitlabJsonBody(operation: Operation, values: InputValues): boolean {
  if (operation.bodyEncoding === undefined) return false;
  if (!validGitlabJsonForm(operation)) throw new Error("GitLab request encoding no longer matches its reviewed contract.");
  return !operation.fields.some(field => {
    if (field.location !== "body") return false;
    const raw = values[field.key]; if (raw === undefined || raw === null || !raw.trim()) return false;
    if (field.format === "binary") return true;
    let value: unknown; try { value = JSON.parse(raw); } catch { return false; }
    return hasFile(operation.bodySchema?.properties?.[field.name] ?? field.schema ?? { type: field.type }, value);
  });
}
function hasFile(schema: InputSchema, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (schema.format === "binary") return true;
  if (Array.isArray(value)) return !!schema.items && value.some(item => hasFile(schema.items!, item));
  return typeof value === "object" && Object.entries(schema.properties ?? {}).some(([name, child]) => Object.hasOwn(value, name)
    && hasFile(child, (value as Record<string, unknown>)[name]));
}
