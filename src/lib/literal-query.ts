// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField } from "./catalog.ts";

/** Keep the source path as its variant identity; only the wire request is split. */
export function literalQueryRoute(path: string): { path: string; query: { beta: "true" } } | undefined {
  const suffix = "?beta=true";
  if (!path.endsWith(suffix)) return;
  const pathname = path.slice(0, -suffix.length);
  if (pathname.includes("?") || !pathname.startsWith("/")) return;
  return { path: pathname, query: { beta: "true" } };
}
export function validateLiteralQueryFields(path: string, fields: readonly Pick<InputField, "location" | "name">[]): void {
  if (literalQueryRoute(path) && fields.some(field => field.location === "query" && field.name === "beta"))
    throw new Error('Fixed query parameter "beta" cannot be redefined as an editable parameter.');
}

export const betaRouteSources: Record<string, string> = {
  anthropic: "c23b4e84fb0d699275f74767c41af4d3c62f1f9457a75bf55e02559abf44e1cd",
  openai: "b7ec5bd5e29c40f0bfa2e53c06ece711a40276653646d9f3db77498d6579ab41",
};
export const betaWorkPrivateIds = new Set([
  "anthropic:beta_acknowledge_work_v1_environments__environment_id__work__work_id__ack_post",
  "anthropic:beta_get_work_v1_environments__environment_id__work__work_id__get",
  "anthropic:beta_list_work_v1_environments__environment_id__work_get",
  "anthropic:beta_poll_work_v1_environments__environment_id__work_poll_get",
  "anthropic:beta_stop_work_v1_environments__environment_id__work__work_id__stop_post",
  "anthropic:beta_update_work_v1_environments__environment_id__work__work_id__post",
]);
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(value: unknown): asserts value {
  if (!value) throw new Error("Beta routes require their reviewed native source contract.");
}

/** Mark credential-bearing work results and preserve the Responses streaming
 * variant. Neither the source IDs nor native query paths are rewritten. */
export function bindBetaRoutes(document: Record<string, any>): void {
  const anthropic = document.info?.title === "Anthropic API";
  requireContract(document.openapi === "3.1.0" && (anthropic ? document.info.version === "sdk-v0.120.0"
    : document.info?.title === "OpenAI API" && document.info.version === "2.3.0")
    && document.servers?.length === 1 && document.servers[0].url === (anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1")
    && object(document.paths));
  let count = 0, privateCount = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    if (!literalQueryRoute(path)) continue;
    requireContract(object(item) && item.servers === undefined);
    for (const [method, operation] of Object.entries(item)) if (methods.has(method)) {
      requireContract(object(operation) && operation.servers === undefined && typeof operation.operationId === "string");
      const catalog = anthropic ? "anthropic" : "openai", id = `${catalog}:${operation.operationId}`;
      requireContract(operation.parameters === undefined || Array.isArray(operation.parameters));
      requireContract(!operation.parameters?.some((parameter: any) => parameter.in === "query" && parameter.name === "beta"));
      if (betaWorkPrivateIds.has(id)) {
        requireContract(operation["x-operations-credential-result"] === undefined);
        operation["x-operations-credential-result"] = true; privateCount++;
      }
      if (id === "openai:beta_createResponse") {
        const content = operation.responses?.["200"]?.content;
        requireContract(method === "post" && path === "/responses?beta=true" && object(content?.["application/json"])
          && object(content?.["text/event-stream"]) && operation["x-operations-response-stream"] === undefined);
        operation["x-operations-response-stream"] = "openai-responses";
      }
      count++;
    }
  }
  requireContract(count === (anthropic ? 120 : 7) && privateCount === (anthropic ? 6 : 0));
}
