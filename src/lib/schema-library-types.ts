// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { PreparedCatalog } from "./catalog.ts";
import type { SchemaDocumentRecord } from "./schema-documents.ts";
import type { SchemaSummary } from "./schema-index.ts";
import type { SchemaPatch } from "./schema-patches.ts";

export type SchemaLibraryRecord = Omit<SchemaDocumentRecord, "document"> & {
  sourceIdentity: string;
  patches?: SchemaPatch[];
  hasPendingUpdate?: boolean;
  bundled?: boolean;
  summary: Omit<SchemaSummary, "operationCount"> & { operationCount: number | null };
};
export type SchemaLibrarySnapshot = { records: SchemaLibraryRecord[]; catalogs: PreparedCatalog[]; active: string[] };
export type SchemaDownload = { text: string; filename: string };
