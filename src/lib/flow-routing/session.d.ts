// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Route, RoutingEdge, RoutingOptions, RoutingScene } from './types.js';
import { routeEdges, routeConnection } from './router.js';

export interface RoutingRequest {
  sceneRevision: number;
  scene: RoutingScene;
  preview: RoutingEdge | null;
  options: RoutingOptions;
}
export interface RoutingReply {
  sceneRevision: number;
  routes: Map<string, Route>;
  connection: Route | null;
  preview: RoutingEdge | null;
}
export function createRoutingSession(engine?: { routeEdges: typeof routeEdges; routeConnection: typeof routeConnection }): {
  calculate(input: RoutingRequest): RoutingReply;
};
