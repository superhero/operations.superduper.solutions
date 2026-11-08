// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { gunzipSync } from "fflate";
import { decodeCompactSchemaPack, decodeAdaptiveSchemaPack, adaptiveSchemaPackPrefix } from "./schema-pack-codec.ts";

export const maxCompactInlineWorkerBytes = 2 * 1024 * 1024;
/** Decode a build-owned program only when its worker is constructed. The
 * original Vite Blob, worker options, errors and URL lifecycle remain in use. */
export function decodeInlineWorkerSource(packed: string, expectedBytes: number): string {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxCompactInlineWorkerBytes)
    throw new Error("Invalid inline worker program size.");
  const compressed = packed.startsWith(adaptiveSchemaPackPrefix) ? decodeAdaptiveSchemaPack(packed.slice(adaptiveSchemaPackPrefix.length)) : decodeCompactSchemaPack(packed);
  if (compressed.length < 18 || new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength).getUint32(compressed.length - 4, true) !== expectedBytes)
    throw new Error("Invalid inline worker program length.");
  const bytes = gunzipSync(compressed);
  if (bytes.byteLength !== expectedBytes) throw new Error("Incomplete inline worker program.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
