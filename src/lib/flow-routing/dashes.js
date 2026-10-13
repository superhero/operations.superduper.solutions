// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { roundedSegments } from './rounding.js';

// Anchor each orthogonal segment's dashes to world coordinates. Adding the same
// animated phase to every offset aligns shared runs regardless of their prefix.
export function dashSegments(route, period = 10, radius = 0, obstacles = []) {
  if (!Number.isFinite(period) || period <= 0) return [];
  return roundedSegments(route, radius, obstacles).map(segment => ({
    path: `M ${segment.from.x} ${segment.from.y} ${segment.command}`,
    offset: ((segment.phase % period) + period) % period,
  }));
}
