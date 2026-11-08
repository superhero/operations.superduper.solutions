// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import contract from "./commerce-authentication-contracts.json" with { type: "json" };

export const commerceAuthenticationSourceSha256 = contract.sourceSha256;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new Error("Commerce authentication does not match its reviewed source contract.");
}

/** The provider documents Commerce access tokens in Authorization: Bearer.
 * Retain the native ASAP requirement name and its six explicit uses. The
 * remaining routes inherit the same mandatory authentication, rather than
 * becoming anonymous because the upstream export omitted the root requirement.
 */
export function bindCommerceAuthentication(document: Record<string, any>): void {
  requireContract(document.openapi === contract.openapi && document.info?.title === contract.title
    && document.info.version === contract.apiVersion && object(document.paths)
    && JSON.stringify(document.servers) === JSON.stringify([{ url: contract.server }])
    && !Object.hasOwn(document, "security") && object(document.components)
    && !Object.hasOwn(document.components, "securitySchemes")
    && !Object.hasOwn(document, "x-upstream-security") && !Object.hasOwn(document, "x-upstream-security-schemes"));
  const expected = contract.operations as Record<string, { method: string; path: string; security: unknown }>;
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    requireContract(object(item) && item.servers === undefined);
    for (const [method, operation] of Object.entries(item)) if (methods.has(method)) {
      requireContract(object(operation) && typeof operation.operationId === "string"
        && Object.hasOwn(expected, operation.operationId) && !seen.has(operation.operationId));
      const reviewed = expected[operation.operationId]!;
      requireContract(reviewed.path === path && reviewed.method === method.toUpperCase()
        && operation.servers === undefined && (reviewed.security === null
          ? !Object.hasOwn(operation, "security") : JSON.stringify(operation.security) === JSON.stringify(reviewed.security)));
      requireContract(Array.isArray(operation.parameters ?? []) && (operation.parameters ?? []).every((parameter: any) =>
        object(parameter) && parameter.$ref === undefined && (parameter.in !== "header"
          || typeof parameter.name === "string" && parameter.name.toLowerCase() !== "authorization")));
      seen.add(operation.operationId);
    }
  }
  requireContract(seen.size === Object.keys(expected).length);
  document["x-upstream-security"] = null;
  document["x-upstream-security-schemes"] = null;
  document.security = [{ ASAP: [] }];
  document.components.securitySchemes = { ASAP: { type: "http", scheme: "bearer",
    description: "An existing Commerce access token for the intended app and transaction account, obtained through the Atlassian Partner portal. Supply the token without the Bearer prefix; the provider validates its permissions and expiry." } };
}
