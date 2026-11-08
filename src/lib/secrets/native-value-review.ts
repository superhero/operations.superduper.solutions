// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError } from './types.ts';

/** Review complete UTF-8 values while retaining the native result nesting limit. */
export function reviewNativeValueStrings(value: unknown, review: (bytes: Uint8Array) => unknown, depth = 0): void {
  if (depth > 32) throw new VaultError('LIMIT');
  if (typeof value === 'string') review(new TextEncoder().encode(value));
  else if (value && typeof value === 'object')
    for (const child of Object.values(value)) reviewNativeValueStrings(child, review, depth + 1);
}
