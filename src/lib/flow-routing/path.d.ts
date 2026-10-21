// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type {
  EdgeEndpoints, Point, Polyline, PreviewCache, Rectangle, Route, RouteGeometry, RoutingEdge
} from "./types.js";

export type { PreviewCache, RouteGeometry } from "./types.js";

export const bendRadius: 4;

export function routePath(
  route: Polyline | null | undefined,
  radius?: number,
  obstacles?: readonly Rectangle[]
): string | null;

/** Empty routes have no midpoint. Rounded routes use their actual drawn length. */
export function routeMidpoint(
  route: RouteGeometry,
  radius?: number,
  obstacles?: readonly Rectangle[]
): Point | undefined;

export function matchesEndpoints(
  route: Polyline | null | undefined,
  edge: Pick<EdgeEndpoints, "sourceX" | "sourceY" | "targetX" | "targetY">
): boolean;

export function cachedPreview<RouteType extends Polyline>(
  cache: PreviewCache<RouteType> | null | undefined,
  current: RoutingEdge | null | undefined,
  session: number
): RouteType | null;

/** Display-only projection: it preserves port directions but does not recheck obstacles. */
export function projectRoute(
  route: (Polyline & { status?: Route["status"] }) | null | undefined,
  edge: EdgeEndpoints | null | undefined
): Route | null;

export function previewPath(
  route: (Polyline & { status?: Route["status"] }) | null | undefined,
  edge: EdgeEndpoints | null | undefined,
  radius?: number,
  obstacles?: readonly Rectangle[]
): string | null;

export function previewRoute(
  route: (Polyline & { status?: Route["status"] }) | null | undefined,
  edge: EdgeEndpoints | null | undefined
): Route | null;
