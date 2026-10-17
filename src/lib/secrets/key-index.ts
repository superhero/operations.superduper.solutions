// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError, vaultLimits, type VaultKey } from "./types.ts";
import type { VaultState } from "./storage.ts";

/** Public, advisory metadata only. Never use this index to authorize credential use. */
export function publicVaultKeys(state: VaultState): { entries: VaultKey[]; needsUnlock: boolean } {
  if (!state.snapshot) return { entries: [], needsUnlock: false };
  if (state.keys === undefined) return { entries: [], needsUnlock: state.snapshot.records.length > 0 };
  if (!Array.isArray(state.keys) || state.keys.length > vaultLimits.records || state.keys.length !== state.snapshot.records.length)
    throw new VaultError("INVALID");
  const ids = new Set(state.snapshot.records.map(record => record.id));
  const entries = state.keys.map(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !ids.delete(item.id) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(item.id) ||
      typeof item.label !== "string" || !item.label.trim() || item.label.length > 120 ||
      item.kind !== "bearer" && item.kind !== "apiKey" && item.kind !== "secret") throw new VaultError("INVALID");
    return { id: item.id, label: item.label, kind: item.kind };
  });
  return { entries, needsUnlock: false };
}
