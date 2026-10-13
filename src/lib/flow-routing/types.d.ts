// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** All routing coordinates and dimensions use absolute diagram units. */
export interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  width: number;
  height: number;
}

export interface NodeRect extends Rectangle {
  id: string;
}

export type PortPosition = "left" | "right" | "top" | "bottom";

export interface EdgeEndpoints {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: PortPosition;
  targetPosition: PortPosition;
}

export interface RoutingEdge extends EdgeEndpoints {
  id: string;
  source: string;
  /** Free-pointer previews do not have a target node. */
  target?: string | undefined;
}

export interface Polyline {
  points: readonly Point[];
}

export type RouteStatus = "routed" | "fallback";

export interface RouteGeometry extends Polyline {
  /** Manhattan length of the unrounded polyline. */
  length: number;
  status?: RouteStatus;
}

export interface Route extends RouteGeometry {
  points: Point[];
  status: RouteStatus;
}

export interface ExistingRoute extends Polyline {
  id: string;
  source?: string | undefined;
  target?: string | undefined;
}

export interface RoutingOptions {
  /** Requested clearance; only constrained terminal faces share a narrower gap. Default: 12. */
  nodePadding?: number;
  /** Preferred straight run leaving each handle. Default: 20. */
  stubLength?: number;
  /** Crossing detour cap relative to the node-avoiding baseline. Default: 4. */
  maxLengthRatio?: number;
  /** Maximum vertices per search. Default: 8192. */
  maxGridPoints?: number;
  /** Shared geometry-check budget per scene or connection. Default: 500000. */
  maxWork?: number;
  /** Maximum scene edges eligible for routing searches. Default: 250. */
  maxRoutedEdges?: number;
}

export interface RoutingScene {
  nodes: NodeRect[];
  edges: RoutingEdge[];
}

export interface PreviewCache<RouteType extends Polyline = Route> {
  geometry: RoutingEdge;
  route: RouteType;
  session: number;
}

export interface StraightSegment {
  from: Point;
  to: Point;
  command: string;
  length: number;
  /** Signed world coordinate used to align visible dash pieces. */
  phase: number;
  center?: never;
  radius?: never;
  sweep?: never;
}

export interface ArcSegment {
  from: Point;
  to: Point;
  command: string;
  length: number;
  phase: number;
  center: Point;
  radius: number;
  sweep: 0 | 1;
}

export type RoundedSegment = StraightSegment | ArcSegment;

export interface DashSegment {
  path: string;
  offset: number;
}
