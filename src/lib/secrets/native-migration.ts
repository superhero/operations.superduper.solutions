// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeMigrationResult, type NativeMigrationMethod } from '../native-migration.ts';
import { VaultError } from './types.ts';

/** Session titles derive from private transcripts; native failure text can include
 * source contents. Only their classified metadata may leave the private worker. */
export function publicNativeMigrationResult(method: NativeMigrationMethod, value: unknown): Record<string, unknown> {
  try {
    const result = nativeMigrationResult(method, value);
    if (method === 'externalAgentConfig/detect') for (const item of result.items as Record<string, unknown>[]) {
      const sessions = (item.details as Record<string, unknown> | null | undefined)?.sessions;
      if (Array.isArray(sessions)) for (const session of sessions) session.title = null;
      if (item.itemType === 'SESSIONS') item.description = 'Local sessions';
    }
    if (method === 'externalAgentConfig/import/readHistories') for (const row of result.data as Record<string, unknown>[]) {
      for (const success of row.successes as Record<string, unknown>[]) success.title = null;
      for (const failure of row.failures as Record<string, unknown>[]) failure.message = 'Native migration failed for ' + failure.itemType + '.';
    }
    return result;
  } catch { throw new VaultError('NATIVE_CONTRACT'); }
}
