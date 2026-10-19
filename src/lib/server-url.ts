// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Check server templates before URL parsing can conceal markers by encoding them. */
export function serverUrlHasPlaceholder(value: string): boolean
{
  return /[<>{}]|%(?:3c|3e|7b|7d)/i.test(value);
}
