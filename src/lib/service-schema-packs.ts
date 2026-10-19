// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import index from "../catalogs/services/index.json" with { type: "json" };

export type ServiceSchemaDescriptor = {
  id: string; name: string; version: string; openapi: string; operations: number;
  sha256: string; bytes: number; compressedBytes: number;
  url?: string; file?: string; provenance?: string; sourceKind?: string; provider?: string;
};

export const serviceSchemaDescriptors: readonly ServiceSchemaDescriptor[] = index;
const packs = import.meta.glob<string>("../catalogs/services/*.json.gz", {
  query: "?url&inline", import: "default", eager: true,
});

/** Decode one audited pack in the schema worker, without executing source code. */
export async function decodeServiceSchema(pack: string, descriptor: Pick<ServiceSchemaDescriptor, "bytes" | "sha256">): Promise<Record<string, unknown>>
{
  const encoded = pack.match(/^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/)?.[1];
  if (!encoded || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > 64 * 1024 * 1024)
    throw new Error("The bundled schema pack metadata is invalid.");
  const compressed = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const bytes = new Uint8Array(descriptor.bytes);
  let length = 0;
  try
  {
    for (;;)
    {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > descriptor.bytes) throw new Error("The bundled schema exceeds its recorded size.");
      bytes.set(value, length - value.byteLength);
    }
  }
  finally { await reader.cancel(); }
  if (length !== descriptor.bytes) throw new Error("The bundled schema is incomplete.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  if (digest !== descriptor.sha256) throw new Error("The bundled schema does not match its recorded hash.");
  const document: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("The bundled schema must contain an OpenAPI document.");
  return document as Record<string, unknown>;
}

export async function readServiceSchema(id: string, library: {
  descriptors: readonly ServiceSchemaDescriptor[]; packs: Record<string, string>;
} = { descriptors: serviceSchemaDescriptors, packs }): Promise<Record<string, unknown>>
{
  const descriptor = library.descriptors.find(descriptor => descriptor.id === id);
  const pack = library.packs[`../catalogs/services/${id}.json.gz`];
  if (!descriptor || !pack) throw new Error(`The bundled schema ${id} is unavailable.`);
  return decodeServiceSchema(pack, descriptor);
}
