// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { DashSegment, Polyline, Rectangle } from "./types.js";

export type { DashSegment } from "./types.js";

/** Pass the rendered dash-plus-gap period to retain world alignment at every dash size. */
export function dashSegments(
  route: Polyline | null | undefined,
  period?: number,
  radius?: number,
  obstacles?: readonly Rectangle[]
): DashSegment[];
