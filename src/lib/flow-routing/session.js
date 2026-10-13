// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { routeEdges, routeConnection } from './router.js';

/** Worker-local cache. Adding one connection preserves all unchanged routes. */
export function createRoutingSession(engine = { routeEdges, routeConnection }) {
  let sceneKey;
  let layoutKey;
  let edgeKeys = new Map();
  let routes = new Map();
  let existingRoutes = [];
  return {
    calculate({ sceneRevision, scene, preview, options }) {
      const key = JSON.stringify([scene, options]);
      if (key !== sceneKey) {
        const nextLayoutKey = JSON.stringify([scene.nodes, options]);
        const nextEdgeKeys = new Map(scene.edges.map(edge => [edge.id, JSON.stringify(edge)]));
        const changed = scene.edges.filter(edge => edgeKeys.get(edge.id) !== nextEdgeKeys.get(edge.id));
        let nextRoutes;
        if (nextLayoutKey === layoutKey && changed.length <= 1) {
          nextRoutes = new Map([...routes].filter(([id]) => nextEdgeKeys.has(id) && edgeKeys.get(id) === nextEdgeKeys.get(id)));
          if (changed.length) {
            const retained = scene.edges.filter(edge => nextRoutes.has(edge.id)).map(edge => ({ ...edge, ...nextRoutes.get(edge.id) }));
            nextRoutes.set(changed[0].id, engine.routeConnection(changed[0], scene.nodes, retained, options));
          }
        } else {
          nextRoutes = engine.routeEdges(scene, options);
        }
        // Commit the cache only after a successful calculation, including edits
        // that retain previous routes. Exceptions keep their native error chain.
        routes = nextRoutes;
        existingRoutes = scene.edges.map(edge => ({ ...edge, ...routes.get(edge.id) })).filter(edge => edge.points);
        layoutKey = nextLayoutKey;
        edgeKeys = nextEdgeKeys;
        sceneKey = key;
      }
      const connection = preview ? engine.routeConnection(preview, scene.nodes, existingRoutes, options) : null;
      return { sceneRevision, routes, connection, preview };
    }
  };
}
