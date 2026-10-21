// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Position } from "@xyflow/svelte";
import { cubicControls } from "./flow-routing/bezier.ts";

type CurvePoints = {
  sourceX: number; sourceY: number; sourcePosition: Position;
  targetX: number; targetY: number; targetPosition: Position;
};

/** Scale both forward and backward control points; 50 preserves the original curve. */
export function workflowCurve(points: CurvePoints, strength: number): [string, number, number] {
  const [source, a, b, target] = cubicControls(points, strength);
  return [`M${source.x},${source.y} C${a.x},${a.y} ${b.x},${b.y} ${target.x},${target.y}`,
    (source.x + 3 * a.x + 3 * b.x + target.x) / 8,
    (source.y + 3 * a.y + 3 * b.y + target.y) / 8];
}
