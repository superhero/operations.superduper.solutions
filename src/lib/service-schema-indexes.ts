// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import manifest from "../catalogs/services/indexes/index.json" with { type: "json" };
import { decodeServiceSchema } from "./service-schema-packs.ts";
import { validateSchemaDiscovery } from "./schema-index.ts";

const packs = import.meta.glob<string>("../catalogs/services/indexes/*.json.gz", {
  query: "?url&inline", import: "default", eager: true,
});
export const schemaAdapterRevision = manifest.adapterRevision;
export const serviceIndexDescriptors = manifest.indexes;
export async function readServiceSchemaIndex(id: string, library: {
  descriptors: readonly typeof serviceIndexDescriptors[number][]; packs: Record<string, string>;
} = { descriptors: serviceIndexDescriptors, packs })
{
  const descriptor = library.descriptors.find(item => item.id === id);
  const pack = library.packs[`../catalogs/services/indexes/${id}.json.gz`];
  if (!descriptor || !pack) throw new Error(`The discovery index for ${id} is unavailable.`);
  return validateSchemaDiscovery(await decodeServiceSchema(pack, descriptor), id, descriptor.sourceRevision);
}
