// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { routingScenario } from '../../flow-routing-test-support.mjs';
import { routeConnection, routeEdges } from './router.js';

const connection = (values = {}) => ({ id: 'new', source: 'source', target: 'target',
  sourceX: 0, sourceY: 0, targetX: 200, targetY: 200,
  sourcePosition: 'right', targetPosition: 'left', ...values });
const cases = [
  [connection(), 'x', -6],
  [connection({ sourceY: 200, targetY: 0 }), 'x', 6],
  [connection({ sourcePosition: 'bottom', targetPosition: 'top' }), 'y', -6],
  [connection({ sourceX: 200, targetX: 0, sourcePosition: 'bottom', targetPosition: 'top' }), 'y', 6],
];

routingScenario(
  'coincident routes travelling in each of the four directions',
  'new connections and complete scenes are routed beside opposing traffic',
  'opposite runs have six units of ordered separation and matching runs still overlap',
  () => () => {
    for (const [edge, across, offset] of cases) {
      const baseline = routeConnection(edge, []);
      const existing = { id: 'existing', points: baseline.points.toReversed() };
      const snapshot = structuredClone(existing);
      const separated = routeConnection(edge, [], [existing]);
      assert.equal(separated.points[1][across], baseline.points[1][across] + offset);
      assert.equal(separated.points[2][across], baseline.points[2][across] + offset);
      assert.deepEqual(separated.points[0], baseline.points[0]);
      assert.deepEqual(separated.points.at(-1), baseline.points.at(-1));
      assert.deepEqual(existing, snapshot);
      assert.deepEqual(routeConnection(edge, [], [{ id: 'matching', points: baseline.points }]), baseline);
      const duplicate = routeConnection(edge, [], [existing, { ...existing, id: 'duplicate' }]);
      assert.deepEqual(duplicate, separated);
    }
    for (const [down, up, across] of [[cases[0][0], cases[1][0], 'x'], [cases[2][0], cases[3][0], 'y']]) {
      const edges = [{ ...down, id: 'a' }, { ...up, id: 'b' }];
      const routes = routeEdges({ nodes: [], edges });
      assert.equal(routes.get('b').points[1][across] - routes.get('a').points[1][across], 6);
      assert.deepEqual(routeEdges({ nodes: [], edges: edges.toReversed() }), routes);
    }
  }
);

routingScenario(
  'a shared opposing run beside an obstacle blocking its preferred lane',
  'directional separation cannot preserve node clearance',
  'the clear original run and existing route remain unchanged',
  () => () => {
    const edge = connection(), nodes = [{ id: 'blocker', x: 173, y: 80, width: 2, height: 40 }];
    const options = { nodePadding: 0 }, baseline = routeConnection(edge, nodes, [], options);
    const existing = { id: 'existing', points: baseline.points.toReversed() }, snapshot = structuredClone(existing);
    assert.deepEqual(routeConnection(edge, nodes, [existing], options), baseline);
    assert.deepEqual(existing, snapshot);
    assert.deepEqual(routeConnection(edge, nodes, [existing], { ...options, maxWork: 0 }).status, 'fallback');
  }
);
