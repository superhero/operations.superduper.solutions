// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** The caller supplies origin from registered IDs, not editable schema content. */
export function schemaDeletionReason(record: { bundled?: boolean; enabled: boolean }): string | null {
  if (record.bundled) return "Default schemas cannot be deleted.";
  if (record.enabled) return "Disable this schema before deleting it.";
  return null;
}
