// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { NodeRect, Point, RoutingEdge } from './types.js';

export interface ClearanceBox { id: string; left: number; top: number; right: number; bottom: number }
export const EPSILON: number;
export function rectangles(nodes: readonly NodeRect[], padding: number): ClearanceBox[];
export function terminalRectangles(nodes: readonly NodeRect[], padding: number, edge: RoutingEdge): ClearanceBox[];
export function intersects(a: Point, b: Point, box: ClearanceBox): boolean;
export function clearRoute(points: readonly Point[], boxes: readonly ClearanceBox[], edge: RoutingEdge, budget: { work: number }): boolean;
