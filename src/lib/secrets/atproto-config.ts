// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { credentialObject } from "./bindings.ts";
import { VaultError, type ApprovedOperation, type AtprotoOAuthMetadata } from "./types.ts";

export const atprotoProxy = "did:web:api.bsky.app#bsky_appview";
export const atprotoScope = "atproto rpc:app.bsky.actor.getPreferences?aud=did:web:api.bsky.app%23bsky_appview";
export const atprotoPath = "/xrpc/app.bsky.actor.getPreferences";
export type AtprotoOAuthInput = { identifier: string; clientId: string; redirectUri: string; label: string };
export type AtprotoOAuthCallback = { state: string; iss: string; code?: string; error?: string };
export type AtprotoOAuthTask = { id: string; state: string; authorizationUrl: string; expiresAt: number; fingerprint: string };
export function publicAtprotoUrl(value: unknown): URL {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value), host = url.hostname;
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href !== value && value !== url.origin
      || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|local|internal|test)$/.test(host)) throw new Error();
    return url;
  } catch { throw new VaultError("PERMISSION"); }
}
export function atprotoCallbackUri(page: string): string {
  const url = new URL(page); url.search = ""; url.hash = ""; url.searchParams.set("operations_oauth_callback", "bluesky");
  return url.href;
}
export function atprotoClientId(page: string): string {
  const url = new URL(page);
  return ["127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:"
    ? "http://localhost?" + new URLSearchParams({ redirect_uri: atprotoCallbackUri(page), scope: atprotoScope })
    : url.origin + "/oauth/bluesky-client-metadata.json";
}
export function validateAtprotoInput(value: unknown, origin: string): AtprotoOAuthInput {
  const input = credentialObject(value);
  if (Object.keys(input).sort().join() !== "clientId,identifier,label,redirectUri" || typeof input.identifier !== "string"
    || !/^(did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%_-]+)|[a-zA-Z0-9][a-zA-Z0-9.-]{1,251}\.[a-zA-Z]{2,63})$/.test(input.identifier)
    || typeof input.label !== "string" || !input.label.trim() || input.label.length > 100 || /[\u0000-\u001f\u007f]/.test(input.label)
    || typeof input.redirectUri !== "string" || atprotoCallbackUri(input.redirectUri) !== input.redirectUri) throw new VaultError("INVALID");
  const redirect = new URL(input.redirectUri);
  if (redirect.origin !== origin) throw new VaultError("PERMISSION");
  const dev = redirect.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(redirect.hostname);
  if (dev) { if (input.clientId !== atprotoClientId(input.redirectUri)) throw new VaultError("PERMISSION"); }
  else if (publicAtprotoUrl(input.clientId).origin !== origin || publicAtprotoUrl(input.redirectUri).origin !== origin) throw new VaultError("PERMISSION");
  return { identifier: input.identifier, clientId: input.clientId as string, redirectUri: input.redirectUri, label: input.label.trim() };
}
export function validateAtprotoMetadata(value: unknown): AtprotoOAuthMetadata {
  const item = credentialObject(value);
  if (Object.keys(item).sort().join() !== "accountId,clientId,issuer,pds,profile,redirectUri,scope" || item.profile !== "atproto-public-dpop-v1"
    || item.scope !== atprotoScope || typeof item.accountId !== "string" || !/^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%_-]+)$/.test(item.accountId)) throw new VaultError("INVALID");
  const redirect = new URL(String(item.redirectUri));
  validateAtprotoInput({ identifier: item.accountId, clientId: item.clientId, redirectUri: item.redirectUri, label: "Bluesky" }, redirect.origin);
  for (const key of ["pds", "issuer"]) { const url = publicAtprotoUrl(item[key]); if (url.href !== url.origin + "/") throw new VaultError("INVALID"); }
  return item as AtprotoOAuthMetadata;
}
export function atprotoOAuthAlternative(descriptor: ApprovedOperation): number | undefined {
  if (descriptor.operation.method !== "GET" || descriptor.operation.path !== atprotoPath
    || descriptor.operation.fields.length || descriptor.operation.bodyRequired || descriptor.operation.bodyMediaType || descriptor.operation.privatePath || descriptor.operation.credentialResult || descriptor.operation.cloudflareUpload) return;
  try { publicAtprotoUrl(descriptor.origin + "/"); } catch { return; }
  const index = descriptor.operation.security?.findIndex(option => option.length === 1 && option[0]?.kind === "bearer"
    && option[0].name === "Bearer" && option[0].header === "Authorization");
  return index !== undefined && index >= 0 ? index : undefined;
}
