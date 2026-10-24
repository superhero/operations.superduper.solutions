// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError, type ApprovedOperation, type GitlabOAuthMetadata } from "./types.ts";
import { credentialObject } from "./bindings.ts";

export const gitlabIssuer = "https://gitlab.com";
export const gitlabCallbackParameter = "operations_oauth_callback";
export type GitlabOAuthInput = { clientId: string; redirectUri: string; label: string };
export type GitlabOAuthCallback = { state: string; code?: string; error?: string };
export type GitlabOAuthTask = { id: string; state: string; authorizationUrl: string; expiresAt: number; fingerprint: string };
export function gitlabCallbackUri(page: string): string {
  const url = new URL(page); url.search = ""; url.hash = ""; url.searchParams.set(gitlabCallbackParameter, "gitlab");
  return validateGitlabRedirect(url.href);
}
export function validateGitlabRedirect(value: unknown, applicationOrigin?: string): string {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value), loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash || url.href !== value || url.protocol !== "https:" && !(url.protocol === "http:" && loopback)
      || applicationOrigin !== undefined && url.origin !== applicationOrigin || [...url.searchParams].length !== 1
      || url.searchParams.get(gitlabCallbackParameter) !== "gitlab") throw new Error();
    return url.href;
  } catch { throw new VaultError("PERMISSION"); }
}
export function validateGitlabInput(value: unknown, applicationOrigin: string): GitlabOAuthInput {
  const input = credentialObject(value);
  if (Object.keys(input).length !== 3 || !["clientId", "redirectUri", "label"].every(key => Object.hasOwn(input, key))
    || typeof input.clientId !== "string" || !/^[a-f0-9]{64}$/i.test(input.clientId)
    || typeof input.label !== "string" || !input.label.trim() || input.label.length > 100 || /[\u0000-\u001f\u007f]/.test(input.label)) throw new VaultError("INVALID");
  return { clientId: input.clientId, redirectUri: validateGitlabRedirect(input.redirectUri, applicationOrigin), label: input.label.trim() };
}
export function validateGitlabMetadata(value: unknown): GitlabOAuthMetadata {
  const metadata = credentialObject(value);
  if (Object.keys(metadata).length !== 5 || metadata.profile !== "gitlab-public-pkce-v1" || metadata.scope !== "read_user"
    || typeof metadata.clientId !== "string" || !/^[a-f0-9]{64}$/i.test(metadata.clientId)
    || typeof metadata.accountId !== "string" || !/^[1-9][0-9]{0,19}$/.test(metadata.accountId)) throw new VaultError("INVALID");
  return { profile: "gitlab-public-pkce-v1", scope: "read_user", clientId: metadata.clientId,
    redirectUri: validateGitlabRedirect(metadata.redirectUri), accountId: metadata.accountId };
}
export function gitlabOAuthAlternative(descriptor: ApprovedOperation): number | undefined {
  if (descriptor.origin !== gitlabIssuer || descriptor.operation.method !== "GET" || descriptor.operation.path !== "/api/v4/user"
    || descriptor.operation.cloudflareUpload || descriptor.operation.privatePath || descriptor.operation.credentialResult) return;
  const index = descriptor.operation.security?.findIndex(option => option.length === 1 && option[0]?.kind === "bearer"
    && option[0].name === "oauth2" && option[0].header === "Authorization");
  return index !== undefined && index >= 0 ? index : undefined;
}
