// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { md5 } from "hash-wasm";
import { validateWorkflowBinary } from "../workflow-binary.ts";
import { VaultError } from "./types.ts";

export async function s3PayloadChecksum(body: BodyInit | null): Promise<string> {
  if (!(body instanceof Blob) || body.size > 500000) throw new VaultError("LIMIT");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await body.arrayBuffer()));
  return btoa(String.fromCharCode(...hash));
}
/** HTTP compression can be invisible behind CORS. Check stored-object integrity
 * before releasing bytes, using full-object SHA256 or a legacy single-part ETag. */
export async function verifyS3Object(headers: Headers, value: unknown): Promise<void> {
  const file = validateWorkflowBinary(value), bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
  const checksum = headers.get("x-amz-checksum-sha256"), kind = headers.get("x-amz-checksum-type");
  if (checksum) {
    if (kind && kind !== "FULL_OBJECT" || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) throw new VaultError("S3_INTEGRITY");
    const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))));
    if (hash !== checksum) throw new VaultError("S3_INTEGRITY");
    return;
  }
  const etag = /^"([a-f0-9]{32})"$/i.exec(headers.get("ETag") ?? "");
  if (!etag || (await md5(bytes)).toLowerCase() !== etag[1]!.toLowerCase()) throw new VaultError("S3_INTEGRITY");
}
