// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { Polyline, Rectangle, RoundedSegment } from "./types.js";

export type { ArcSegment, RoundedSegment, StraightSegment } from "./types.js";

/** Circular bends are limited by adjacent legs and disabled where their bounds overlap a node. */
export function roundedSegments(
  route: Polyline | null | undefined,
  radius?: number,
  obstacles?: readonly Rectangle[]
): RoundedSegment[];
