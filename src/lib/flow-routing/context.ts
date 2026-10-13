// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { NodeRect, Point, Route, RoutingEdge } from './types.js';
import type { SegmentHandle } from './manual.js';

export const routingContext = Symbol('svelte-flow-routing');
export interface RoutingContext {
  route(id: string): Route | undefined;
  /** Node bounds plus clearance, shared by every rounded renderer. */
  obstacles(): NodeRect[];
  preview(): Route | null;
  connection(): RoutingEdge | null;
  dashPeriod(): number;
  editable(): boolean;
  manual(id: string): boolean;
  manualState(id: string): Route['manualState'];
  dragging(id: string): boolean;
  dragHandle(id: string): SegmentHandle | null;
  begin(id: string, index: number): { axis: 'x' | 'y'; coordinate: number } | null;
  move(id: string, coordinate: number): void;
  finish(id: string): void;
  cancel(id: string): void;
  resetRoute(id: string): void;
}

export type RouteChange = (id: string, points: Point[] | undefined) => void;
