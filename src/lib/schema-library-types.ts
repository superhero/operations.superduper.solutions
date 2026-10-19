// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { PreparedCatalog } from "./catalog.ts";
import type { SchemaDocumentRecord } from "./schema-documents.ts";

export type SchemaLibraryRecord = SchemaDocumentRecord & {
  summary: { name: string; serverUrl: string; operationCount: number; unavailableCount?: number };
};
export type SchemaLibrarySnapshot = { records: SchemaLibraryRecord[]; catalogs: PreparedCatalog[] };
export type SchemaDownload = { text: string; filename: string };
