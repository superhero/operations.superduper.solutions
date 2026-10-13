// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { NodeRect, Point, Polyline, Route, RoutingEdge, RoutingOptions } from './types.js';

export interface SegmentHandle { index: number; x: number; y: number; axis: 'x' | 'y' }
export interface SegmentDrag {
  points: Point[];
  movingIndices: [number, number];
  axis: 'x' | 'y';
  startCoordinate: number;
  low: number;
  high: number;
  original: Point[];
}
/** Validate, clone, and remove only exact duplicates and same-direction collinear points. */
export function normalizeManualRoute(input: unknown): Point[] | null;
export function segmentHandles(route: Polyline | null | undefined): SegmentHandle[];
/** Capture a fixed topology and the connected clearance-safe interval containing its start. */
export function prepareSegmentDrag(route: Polyline, index: number, edge: RoutingEdge, nodes: readonly NodeRect[], options?: RoutingOptions): SegmentDrag | null;
export function moveSegment(drag: SegmentDrag, coordinate: number): { route: Route; coordinate: number; limited: boolean };
/** Project authored anchors onto the current ports and certify the shared clearance policy. */
export function resolveManualRoute(points: unknown, edge: RoutingEdge, nodes: readonly NodeRect[], options?: RoutingOptions): Route | null;
