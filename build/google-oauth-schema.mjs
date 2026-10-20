// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { applySchemaPatches, googleOauthAlternatives } from '../src/lib/schema-patches.ts';

/** Reviewed Google correction shared by bundled generation and Git-backed updates. */
export function adaptGoogleOauthSchema(input) {
  return applySchemaPatches(input, [googleOauthAlternatives]);
}
