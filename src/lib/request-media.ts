// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** RFC 6839 structured +json media use JSON syntax with their own Content-Type. */
export function isJsonRequestMediaType(media: string): boolean {
  return media === media.trim() && /^(?:application\/json|[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json)$/i.test(media);
}
