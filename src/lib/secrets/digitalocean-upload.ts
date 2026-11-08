// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { digitalOceanStorageOrigin, validDigitalOceanUpload } from "../digitalocean-destinations.ts";
import { VaultError, type ApprovedOperation } from "./types.ts";
import type { AcquiredValue, AcquiredReference } from "./credential-results.ts";

/** SigV4 S3 capability URLs are issued by the inference API and kept in Secrets.
 * Parsing is validation only: never sort/re-encode their signature-bearing URL. */
export function parseDigitalOceanUploadUrl(token: string, now = Date.now()): { url: URL; expiresAt: number; secrets: string[] } {
  if (typeof token !== "string" || /[\\\u0000-\u0020\u007f]/.test(token)) throw new VaultError("PERMISSION");
  let raw = token, boundExpiry: number | undefined;
  if (token.startsWith("{")) {
    let envelope: Record<string, unknown>;
    try { envelope = JSON.parse(token); } catch { throw new VaultError("PERMISSION"); }
    if (!envelope || envelope.kind !== "digitalocean-upload" || envelope.version !== 1 || typeof envelope.url !== "string"
      || !Number.isSafeInteger(envelope.expiresAt) || Object.keys(envelope).sort().join(",") !== "expiresAt,kind,url,version") throw new VaultError("PERMISSION");
    raw = envelope.url; boundExpiry = envelope.expiresAt as number;
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new VaultError("PERMISSION"); }
  try { digitalOceanStorageOrigin(url.origin); } catch { throw new VaultError("PERMISSION"); }
  if (url.username || url.password || url.hash || url.href !== raw)
    throw new VaultError("PERMISSION");
  const one = (name: string) => { const values = url.searchParams.getAll(name); if (values.length !== 1) throw new VaultError("PERMISSION"); return values[0]!; };
  const algorithm = one("X-Amz-Algorithm"), credential = one("X-Amz-Credential"), date = one("X-Amz-Date"), expiry = one("X-Amz-Expires"),
    headers = one("X-Amz-SignedHeaders"), signature = one("X-Amz-Signature");
  if (algorithm !== "AWS4-HMAC-SHA256" || !/^[A-Za-z0-9_-]+\/\d{8}\/[a-z0-9-]+\/s3\/aws4_request$/.test(credential)
    || !/^\d{8}T\d{6}Z$/.test(date) || !/^[1-9]\d{0,5}$/.test(expiry) || Number(expiry) > 604800
    || !/^(?:host|content-type;host)$/.test(headers) || !/^[a-f0-9]{64}$/i.test(signature)) throw new VaultError("PERMISSION");
  const iso = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${date.slice(9,11)}:${date.slice(11,13)}:${date.slice(13,15)}.000Z`, issuedAt = Date.parse(iso);
  if (!Number.isFinite(issuedAt) || new Date(issuedAt).toISOString() !== iso || !credential.includes(`/${date.slice(0,8)}/`)) throw new VaultError("PERMISSION");
  const expiresAt = Math.min(issuedAt + Number(expiry) * 1000, boundExpiry ?? Infinity);
  if (expiresAt <= now) throw new VaultError("PERMISSION");
  return { url, expiresAt, secrets: [token, raw, url.search, credential, signature, signature.toLowerCase(), signature.toUpperCase(), ...url.searchParams.getAll("X-Amz-Security-Token")] };
}
export function digitalOceanUploadUrl(descriptor: ApprovedOperation, path: string, token: string, now = Date.now()) {
  if (!validDigitalOceanUpload(descriptor.operation) || path !== descriptor.operation.path) throw new VaultError("PERMISSION");
  const result = parseDigitalOceanUploadUrl(token, now);
  if (descriptor.origin !== result.url.origin) throw new VaultError("PERMISSION");
  return result;
}
/** The URL and its shorter provider expiry are stored as one private credential.
 * Only a reference, file identity and nonsecret storage origin reach a workflow. */
export function prepareDigitalOceanUploadResult(status: number, input: unknown) {
  if (status !== 201 || !input || typeof input !== "object" || Array.isArray(input)) throw new VaultError("INVALID");
  const value = input as Record<string, unknown>, parsed = parseDigitalOceanUploadUrl(value.upload_url as string);
  if (typeof value.file_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.file_id)) throw new VaultError("INVALID");
  let expiresAt = parsed.expiresAt;
  if (value.expires_at !== undefined && value.expires_at !== null) {
    if (typeof value.expires_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.expires_at)) throw new VaultError("INVALID");
    const providerExpiry = Date.parse(value.expires_at);
    if (!Number.isFinite(providerExpiry)) throw new VaultError("INVALID");
    expiresAt = Math.min(expiresAt, providerExpiry);
  }
  if (expiresAt <= Date.now()) throw new VaultError("PERMISSION");
  const values: AcquiredValue[] = [{ field: "upload_url", value: JSON.stringify({ kind: "digitalocean-upload", version: 1, url: parsed.url.href, expiresAt }) }];
  const body = { file_id: value.file_id, ...(value.expires_at !== undefined ? { expires_at: value.expires_at } : {}), upload_origin: parsed.url.origin };
  return { values, complete(references: readonly AcquiredReference[]) {
    const reference = references[0];
    if (references.length !== 1 || !reference || typeof reference.credentialId !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference.credentialId)
      || typeof reference.label !== "string" || Object.keys(reference).sort().join(",") !== "credentialId,label") throw new VaultError("INVALID");
    return { ...body, upload_url: structuredClone(reference) };
  } };
}
