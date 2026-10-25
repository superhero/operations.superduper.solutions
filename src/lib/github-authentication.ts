// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readGithubAuthenticationContracts } from "./github-authentication-data.ts";

type Profile = "personal" | "app-user" | "installation" | "app-jwt" | "oauth-basic" | "classic-user" | "classic-personal" | "unreviewed";
type Contract = { method: string; path: string; serverUrl: string; profiles: Profile[]; anonymous: boolean;
  category: string; subcategory: string; permissions: Record<string, string>[]; credentialFields?: string[]; notes?: string[] };
type Contracts = { version: number; docsRevision: string; apiVersion: string; operations: Record<string, Contract> };
let contracts: Contracts | undefined;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const names: Record<Profile, string> = { personal: "GitHubPersonalAccessToken", "app-user": "GitHubAppUserToken",
  installation: "GitHubInstallationToken", "app-jwt": "GitHubAppJWT", "oauth-basic": "GitHubOAuthApp",
  "classic-user": "GitHubClassicUserToken", "classic-personal": "GitHubClassicPersonalAccessToken", unreviewed: "GitHubAuthenticationNotReviewed" };
const definitions: Record<string, Record<string, string>> = {
  GitHubPersonalAccessToken: { type: "http", scheme: "bearer", description: "A personal access token accepted by this endpoint. GitHub validates its permissions and resource access." },
  GitHubAppUserToken: { type: "http", scheme: "bearer", description: "An existing GitHub App user access token; this is not an app JWT or installation token." },
  GitHubInstallationToken: { type: "http", scheme: "bearer", description: "An existing access token for the intended GitHub App installation; acquisition and renewal are separate." },
  GitHubAppJWT: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "An existing JWT authenticating as the GitHub App. This does not mint JWTs or accept a user-token fallback." },
  GitHubOAuthApp: { type: "http", scheme: "basic", description: "Use the OAuth application's client ID as username and its client secret as password." },
  GitHubClassicUserToken: { type: "http", scheme: "bearer", description: "An OAuth user token or classic personal access token with the documented scopes; fine-grained tokens are not qualified here." },
  GitHubClassicPersonalAccessToken: { type: "http", scheme: "bearer", description: "A personal access token (classic) with notifications or repo scope. Notifications do not accept fine-grained or GitHub App tokens; OAuth user tokens are not qualified here." },
  GitHubAuthenticationNotReviewed: { type: "http", scheme: "github-unreviewed", description: "The pinned GitHub data does not qualify an authentication profile for this operation. Missing metadata does not make it public." },
};
const object = (input: unknown): input is Record<string, any> => !!input && typeof input === "object" && !Array.isArray(input);
const server = (input: unknown, expected: string): boolean => Array.isArray(input) && input.length === 1 && input[0]?.url === expected;

/** Apply the reviewed endpoint matrix, without treating permission-free as anonymous. */
export function adaptGithubAuthentication(document: Record<string, any>): void {
  if (document.openapi !== "3.1.0" || document.info?.title !== "GitHub v3 REST API" || document.info.version !== "1.1.4"
    || !server(document.servers, "https://api.github.com") || !object(document.paths) || !object(document.components))
    throw new Error("GitHub authentication adaptation requires the reviewed native revision and direct API endpoint.");
  const data = contracts ??= readGithubAuthenticationContracts() as Contracts;
  const stamp = { version: data.version, docsRevision: data.docsRevision, apiVersion: data.apiVersion };
  if (document["x-operations-github-authentication"] !== undefined) {
    if (JSON.stringify(document["x-operations-github-authentication"]) !== JSON.stringify(stamp))
      throw new Error("GitHub authentication adaptation cannot overwrite another contract revision.");
    return;
  }
  // An explicit upstream root requirement owns its authentication semantics.
  if (document.security !== undefined) return;
  const schemes = document.components.securitySchemes ?? {};
  if (!object(schemes) || Object.keys(definitions).some(name => Object.hasOwn(schemes, name)))
    throw new Error("GitHub authentication adaptation cannot overwrite security definitions.");
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    if (!object(item)) throw new Error("GitHub authentication adaptation requires HTTP path items.");
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      if (!object(operation) || typeof operation.operationId !== "string" || !Object.hasOwn(data.operations, operation.operationId))
        throw new Error("GitHub authentication adaptation cannot authenticate an unreviewed operation.");
      const contract = data.operations[operation.operationId]!;
      if (seen.has(operation.operationId) || contract.method !== method || contract.path !== path
        || !server(operation.servers ?? item.servers ?? document.servers, contract.serverUrl))
        throw new Error("GitHub authentication adaptation requires the reviewed method, path and destination.");
      seen.add(operation.operationId);
      if (operation["x-operations-credential-result"] !== undefined && operation["x-operations-credential-result"] !== true)
        throw new Error("GitHub authentication adaptation cannot overwrite credential-result metadata.");
      if (contract.credentialFields?.length) operation["x-operations-credential-result"] = true;
      if (operation.security !== undefined) continue;
      if (Object.hasOwn(operation, "x-upstream-security") || Object.hasOwn(operation, "x-github-authentication"))
        throw new Error("GitHub authentication adaptation cannot overwrite operation provenance.");
      operation["x-upstream-security"] = null;
      operation.security = [
        ...(contract.anonymous && contract.profiles.length ? [{}] : []),
        ...contract.profiles.map(profile => ({ [names[profile]]: [] })),
      ];
      operation["x-github-authentication"] = structuredClone({ profiles: contract.profiles, anonymous: contract.anonymous,
        permissions: contract.permissions, ...(contract.notes ? { notes: contract.notes } : {}) });
    }
  }
  if (seen.size !== Object.keys(data.operations).length)
    throw new Error("GitHub authentication adaptation requires the complete reviewed operation inventory.");
  document.components.securitySchemes = { ...schemes, ...structuredClone(definitions) };
  document["x-operations-github-authentication"] = stamp;
}
