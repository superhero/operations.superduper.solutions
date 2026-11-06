// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { md5, crc32 } from "hash-wasm";
import type { Operation } from "./catalog.ts";
import { awsRestContract, awsRestContracts, awsRestRoot } from "./aws-rest.ts";
import { WorkflowBodyError } from "./workflow-body-error.ts";

function invalid(): never { throw new WorkflowBodyError("CODEC"); }
const base64 = (hex: string) => Uint8Array.from(hex.match(/../g)!, part => parseInt(part, 16)).toBase64();
/** Compute/check the SDK-declared checksums over the final bytes, before SigV4. */
export async function awsRestChecksums(operation: Operation, headers: Headers, body: BodyInit | null): Promise<void> {
  const contract = awsRestContract(operation); if (!contract?.wirePath) return;
  let bytes: Uint8Array<ArrayBuffer>;
  if (body === null) bytes = new Uint8Array();
  else if (typeof body === "string") bytes = new TextEncoder().encode(body);
  else if (body instanceof Uint8Array) bytes = new Uint8Array(body);
  else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body.slice(0));
  else if (body instanceof Blob && body.size <= 8 * 1024 * 1024) bytes = new Uint8Array(await body.arrayBuffer());
  else invalid();
  if (bytes.byteLength > 8 * 1024 * 1024) throw new WorkflowBodyError("LIMIT");
  const put = (name: string, expected: string) => {
    const previous = headers.get(name); if (previous !== null && previous !== expected) invalid();
    headers.set(name, expected);
  };
  const root = awsRestRoot(awsRestContracts().sources[contract.catalog]!, contract.input, contract.inputTraits);
  const member = contract.checksum?.algorithmMember;
  const algorithmHeader = member && (root.members?.[member]?.locationName ?? member);
  const algorithm = algorithmHeader ? headers.get(algorithmHeader) : null;
  if (algorithm && !["CRC32", "CRC32C", "SHA1", "SHA256"].includes(algorithm)) invalid();
  for (const name of ["CRC32", "CRC32C", "SHA1", "SHA256"]) {
    const field = "x-amz-checksum-" + name.toLowerCase();
    if (algorithm !== name && !headers.has(field)) continue;
    const value = name.startsWith("CRC") ? base64(await crc32(bytes, name === "CRC32C" ? 0x82f63b78 : 0xedb88320))
      : new Uint8Array(await crypto.subtle.digest(name === "SHA1" ? "SHA-1" : "SHA-256", bytes)).toBase64();
    put(field, value);
  }
  if (headers.has("content-md5") || contract.checksum?.required && !algorithm) put("content-md5", base64(await md5(bytes)));
  for (const prefix of ["x-amz-server-side-encryption-customer-", "x-amz-copy-source-server-side-encryption-customer-"]) {
    const encoded = headers.get(prefix + "key"); if (!encoded) continue;
    let key: Uint8Array; try { key = Uint8Array.fromBase64(encoded); } catch { invalid(); }
    if (key.byteLength !== 32 || key.toBase64() !== encoded) invalid();
    put(prefix + "key-MD5", base64(await md5(key)));
  }
}
