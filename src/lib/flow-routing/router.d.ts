// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { ExistingRoute, NodeRect, Route, RoutingEdge, RoutingOptions } from "./types.js";

export type {
  EdgeEndpoints, ExistingRoute, NodeRect, Point, PortPosition, Route,
  RouteGeometry, RouteStatus, RoutingEdge, RoutingOptions, RoutingScene
} from "./types.js";

/** Deterministic, bounded scene routing; returns a visible fallback when a search cannot finish. */
export function routeEdges(
  scene: { nodes: readonly NodeRect[]; edges: readonly RoutingEdge[] },
  options?: RoutingOptions
): Map<string, Route>;

/** Route one connection without moving the existing routes. */
export function routeConnection(
  edge: RoutingEdge,
  nodes: readonly NodeRect[],
  existingRoutes?: readonly ExistingRoute[],
  options?: RoutingOptions
): Route;
