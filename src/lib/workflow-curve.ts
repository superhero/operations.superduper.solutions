// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Position, XYPosition } from "@xyflow/svelte";

type CurvePoints = {
  sourceX: number; sourceY: number; sourcePosition: Position;
  targetX: number; targetY: number; targetPosition: Position;
};

/** Curved routes share the obstacle-checked backbone; strength softens its bends. */
export const workflowCurveRadius = (strength: number): number => Math.max(0, Math.min(200, strength)) / 2;

/** Scale both forward and backward control points; 50 preserves the original curve. */
export function workflowCurve(points: CurvePoints, strength: number): [string, number, number] {
  const source = { x: points.sourceX, y: points.sourceY };
  const target = { x: points.targetX, y: points.targetY };
  function control(from: XYPosition, to: XYPosition, side: Position): XYPosition {
    const horizontal = side === "left" || side === "right";
    const direction = side === "left" || side === "top" ? -1 : 1;
    const distance = direction * (horizontal ? to.x - from.x : to.y - from.y);
    const offset = (distance >= 0 ? distance / 2 : 6.25 * Math.sqrt(-distance)) * strength / 50 * direction;
    return horizontal ? { x: from.x + offset, y: from.y } : { x: from.x, y: from.y + offset };
  }
  const a = control(source, target, points.sourcePosition);
  const b = control(target, source, points.targetPosition);
  return [`M${source.x},${source.y} C${a.x},${a.y} ${b.x},${b.y} ${target.x},${target.y}`,
    (source.x + 3 * a.x + 3 * b.x + target.x) / 8,
    (source.y + 3 * a.y + 3 * b.y + target.y) / 8];
}
