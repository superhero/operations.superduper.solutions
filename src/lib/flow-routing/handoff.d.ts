// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { PreviewCache, Route, RoutingEdge } from './types.js';

/** A release must belong to the same drag and exact latest snapped endpoints. */
export function releasedPreview(
  cache: PreviewCache | null,
  lastPreview: RoutingEdge | null,
  session: number,
  edge: RoutingEdge
): Route | null;
