// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError, type OAuth1CredentialReference } from "./types.ts";

export type OAuth1Values = { [K in keyof OAuth1CredentialReference]: string };
/** Deterministic hooks belong to private execution tests, never the worker RPC. */
export type OAuth1Clock = { nonce: () => string; timestamp: () => number };
const encoder = new TextEncoder();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clock: OAuth1Clock = {
  nonce: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""),
  timestamp: () => Math.floor(Date.now() / 1000),
};

function parameters(text: string): [string, string][] {
  if (encoder.encode(text).byteLength > 1024 * 1024) throw new VaultError("LIMIT");
  if (!text) return [];
  const pairs = text.split("&").filter(Boolean);
  if (pairs.length > 10000) throw new VaultError("LIMIT");
  return pairs.map(pair => {
    const index = pair.indexOf("="), parts = index < 0 ? [pair, ""] : [pair.slice(0, index), pair.slice(index + 1)];
    try {
      const [name, value] = parts.map(part => decodeURIComponent(part.replace(/\+/g, " ")));
      // Request parameters may not supply or override OAuth protocol fields.
      if (name!.toLowerCase().startsWith("oauth_")) throw new VaultError("PERMISSION");
      return [name!, value!];
    } catch { throw new VaultError("PERMISSION"); }
  });
}

/** RFC 5849 normalization signs the exact serialized query and URL-encoded body.
 * JSON, binary and multipart bodies do not contribute signature parameters.
 * Returned material is private: register it for redaction before returning data. */
export async function signOAuth1(method: string, destination: string, contentType: string | null,
  body: BodyInit | null, values: OAuth1Values, runtime: OAuth1Clock = clock, version = true):
  Promise<{ authorization: string; secrets: string[] }> {
  try {
    const url = new URL(destination);
    if (!/^[A-Z]+$/.test(method) || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new VaultError("PERMISSION");
    const nonce = runtime.nonce(), timestamp = runtime.timestamp();
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(nonce) || !Number.isSafeInteger(timestamp) || timestamp <= 0) throw new VaultError("INVALID");
    const oauth: [string, string][] = [
      ["oauth_consumer_key", values.consumerKey], ["oauth_nonce", nonce], ["oauth_signature_method", "HMAC-SHA1"],
      ["oauth_timestamp", String(timestamp)], ["oauth_token", values.accessToken], ...(version ? [["oauth_version", "1.0"] as [string, string]] : []),
    ];
    const pairs = [...parameters(url.search.slice(1)), ...oauth];
    if (contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded" && body !== null) {
      if (typeof body !== "string" && !(body instanceof URLSearchParams)) throw new VaultError("PERMISSION");
      pairs.push(...parameters(String(body)));
    }
    const normalized = pairs.map(([name, value]) => [encode(name), encode(value)] as const)
      .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1])).map(pair => pair.join("=")).join("&");
    const base = [method, url.origin + url.pathname, normalized].map(encode).join("&");
    if (encoder.encode(base).byteLength > 1024 * 1024) throw new VaultError("LIMIT");
    const signingKey = `${encode(values.consumerSecret)}&${encode(values.tokenSecret)}`;
    const key = await crypto.subtle.importKey("raw", encoder.encode(signingKey), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(base)));
    const signature = btoa(String.fromCharCode(...bytes));
    const authorization = "OAuth " + [...oauth, ["oauth_signature", signature] as [string, string]]
      .sort((a, b) => compare(a[0], b[0])).map(([name, value]) => `${encode(name)}="${encode(value)}"`).join(", ");
    return { authorization, secrets: [...Object.values(values).map(encode), signingKey, normalized, base, signature, encode(signature), authorization] };
  } catch (error) { throw error instanceof VaultError ? new VaultError(error.code) : new VaultError("PERMISSION"); }
}
