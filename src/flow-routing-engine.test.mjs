// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Cases ported individually from laya-ai/test/unit/flow-edge-routing.test.js.
import { routingScenario } from './flow-routing-test-support.mjs';
import assert from 'node:assert/strict';
import { routeEdges, routeConnection } from './lib/flow-routing/router.js';

const edge = (values = {}) => ({ id: 'edge', source: 'a', target: 'b', sourceX: 0, sourceY: 0,
  targetX: 300, targetY: 0, sourcePosition: 'right', targetPosition: 'left', ...values });
const node = (id, x, y, width, height) => ({ id, x, y, width, height });
const route = (connection, nodes = [], options) => routeEdges({ nodes, edges: [connection] }, options).get(connection.id);
const length = (points) => points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y), 0);

function avoids(points, nodes, connection) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    assert.ok(a.x === b.x || a.y === b.y, 'every segment is orthogonal');
    for (const box of nodes) {
      if (i === 1 && box.id === connection.source || i === points.length - 1 && box.id === connection.target) continue;
      const collision = a.x === b.x ? a.x > box.x && a.x < box.x + box.width &&
        Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height :
        a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
      assert.equal(collision, false, `segment ${i} intersects ${box.id}`);
    }
  }
}

function respectsPorts(output, connection) {
  const { points } = output;
  assert.deepEqual(points[0], { x: connection.sourceX, y: connection.sourceY });
  assert.deepEqual(points.at(-1), { x: connection.targetX, y: connection.targetY });
  const direction = (a, b) => a.x < b.x ? 'right' : a.x > b.x ? 'left' : a.y < b.y ? 'bottom' : 'top';
  assert.equal(direction(points[0], points[1]), connection.sourcePosition);
  assert.equal(direction(points.at(-1), points.at(-2)), connection.targetPosition);
  assert.equal(output.length, length(points));
}

routingScenario(
  "a clear horizontal connection and a rectangular blocker",
  "the connection is routed before and after adding the blocker",
  "routes around blockers and retains the shortest direct route where clear",
  () => {
    const connection = edge();
    const actual = route(connection).points;
    return () => {
      assert.deepEqual(actual, [{ x: 0, y: 0 }, { x: 300, y: 0 }]);
      const nodes = [node('blocker', 100, -30, 100, 60)];
      const output = route(connection, nodes);
      assert.equal(output.status, 'routed');
      assert.ok(output.length > 300);
      assert.ok(output.points.some((point) => Math.abs(point.y) >= 42));
      avoids(output.points, nodes, connection);
      respectsPorts(output, connection);
    };
  }
);

routingScenario(
  "backward and vertical connections with measured endpoint nodes",
  "the routes are calculated for every port orientation",
  "backward and vertical routes honor ports and avoid their own node bodies",
  () => {
    const fixtures = [
      { connection: edge({ sourceX: 250, targetX: 0 }), nodes: [node('a', 200, -25, 50, 50), node('b', 0, -25, 50, 50)] },
      { connection: edge({ sourceX: 0, sourceY: 200, targetX: 0, targetY: 0, sourcePosition: 'bottom', targetPosition: 'top' }),
        nodes: [node('a', -25, 150, 50, 50), node('b', -25, 0, 50, 50)] },
      { connection: edge({ sourceX: 50, sourceY: 0, targetX: 220, targetY: 150, sourcePosition: 'top', targetPosition: 'bottom' }),
        nodes: [node('a', 0, 0, 100, 50), node('b', 200, 100, 100, 50)] },
    ];
    return () => {
      for (const { connection, nodes } of fixtures) {
        const output = route(connection, nodes);
        assert.equal(output.status, 'routed');
        respectsPorts(output, connection);
        avoids(output.points, nodes, connection);
      }
    };
  }
);

routingScenario(
  "fractional endpoint coordinates and a movable blocker",
  "the blocker moves out of the route",
  "fractional coordinates and moved nodes produce valid updated routes without mutation",
  () => {
    const connection = edge({ sourceX: 0.125, sourceY: 5.375, targetX: 300.625, targetY: 5.375 });
    const nodes = [node('blocker', 100.75, -30.25, 100.5, 60.75)];
    const snapshot = structuredClone({ nodes, connection });
    const before = route(connection, nodes);
    const after = route(connection, [{ ...nodes[0], y: 100 }]);
    return () => {
      assert.equal(before.status, 'routed');
      assert.equal(after.points.length, 2);
      assert.notDeepEqual(before.points, after.points);
      avoids(before.points, nodes, connection);
      assert.deepEqual({ nodes, connection }, snapshot);
    };
  }
);

routingScenario(
  "two adjacent nodes separated by a narrow gap",
  "the connection is routed through the narrow gap",
  "cramped adjacent nodes relax padding without crossing node bodies",
  () => {
    const connection = edge({ sourceX: 50, targetX: 60 });
    const nodes = [node('a', 0, -20, 50, 40), node('b', 60, -20, 50, 40)];
    const output = route(connection, nodes);
    return () => {
      assert.equal(output.status, 'routed');
      assert.equal(output.length, 10);
      respectsPorts(output, connection);
      avoids(output.points, nodes, connection);
    };
  }
);

routingScenario(
  "a horizontal preview crossing a short existing vertical arrow",
  "the preview is routed with the default crossing budget",
  "connection previews avoid a nearby crossing within the allowed detour",
  () => {
    const connection = edge();
    const existing = [{ id: 'vertical', source: 'c', target: 'd', points: [{ x: 150, y: -40 }, { x: 150, y: 40 }] }];
    const output = routeConnection(connection, [], existing);
    return () => {
      assert.equal(output.status, 'routed');
      assert.ok(output.length > 300 && output.length <= 1200);
      assert.ok(output.points.some((point) => Math.abs(point.y) > 40));
      respectsPorts(output, connection);
    };
  }
);

routingScenario(
  "a horizontal preview crossing a very long existing vertical arrow",
  "the crossing detour would exceed the default budget",
  "retains a crossing when avoiding it would exceed 300 percent additional length",
  () => {
    const connection = edge();
    const existing = [{ id: 'vertical', source: 'c', target: 'd', points: [{ x: 150, y: -1000 }, { x: 150, y: 1000 }] }];
    const output = routeConnection(connection, [], existing);
    return () => {
      assert.equal(output.status, 'routed');
      assert.equal(output.length, 300);
      assert.equal(output.points.length, 2);
    };
  }
);

routingScenario(
  "crossings at and immediately beyond the maximum allowed detour",
  "the crossing lengths are compared with the four-times baseline",
  "accepts a crossing detour exactly at 4 times the baseline, but rejects one beyond it",
  () => {
    return () => {
      for (const [extent, expectedLength] of [[430, 1200], [431, 300]]) {
        const existing = [{ id: 'vertical', source: 'c', target: 'd', points: [{ x: 150, y: -extent }, { x: 150, y: extent }] }];
        assert.equal(routeConnection(edge(), [], existing).length, expectedLength);
      }
    };
  }
);

routingScenario(
  "a blocker whose height requires a very long detour",
  "node avoidance is evaluated with the crossing budget",
  "node avoidance takes priority even when the necessary detour exceeds the crossing budget",
  () => {
    const connection = edge();
    const nodes = [node('tall blocker', 100, -1000, 100, 2000)];
    const output = route(connection, nodes);
    return () => {
      assert.equal(output.status, 'routed');
      assert.ok(output.length > 300 * 4);
      avoids(output.points, nodes, connection);
      respectsPorts(output, connection);
    };
  }
);

routingScenario(
  "a blocked connection with another crossing beyond its obstacle",
  "crossing avoidance is evaluated with default and strict budgets",
  "crossing improvements retain node clearance, including with a strict length budget",
  () => {
    const connection = edge();
    const nodes = [node('blocker', 100, -40, 60, 80)];
    const existing = [{ id: 'vertical', source: 'c', target: 'd', points: [{ x: 250, y: -120 }, { x: 250, y: 120 }] }];
    const original = route(connection, nodes);
    const output = routeConnection(connection, nodes, existing);
    return () => {
      assert.equal(output.status, 'routed');
      assert.ok(output.length > original.length && output.length <= original.length * 4);
      avoids(output.points, nodes, connection);
      const restricted = routeConnection(connection, nodes, existing, { maxLengthRatio: 1 });
      assert.equal(restricted.length, original.length);
      avoids(restricted.points, nodes, connection);
    };
  }
);

routingScenario(
  "an existing route leaving the same source port as a new connection",
  "the new connection is routed along the shared stem",
  "shared port stems do not force a detour",
  () => {
    const connection = edge();
    const existing = [{ id: 'shared', source: 'a', target: 'd', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }];
    const output = routeConnection(connection, [], existing);
    return () => {
      assert.equal(output.length, 300);
    };
  }
);

routingScenario(
  "two outputs approaching one input from different heights",
  "the upper connection approaches the existing lower bend",
  "joins an existing bend directly instead of adding a dogleg before the shared input",
  () => {
    const nodes = [node('object', 0, 0, 100, 200), node('switch', 400, 240, 100, 80)];
    const connection = edge({ source: 'object', target: 'switch', sourceX: 100, sourceY: 40, targetX: 400, targetY: 260 });
    const existing = [{ id: 'lower', source: 'object', target: 'switch', points: [
      { x: 100, y: 140 }, { x: 380, y: 140 }, { x: 380, y: 260 }, { x: 400, y: 260 },
    ] }];
    const output = routeConnection(connection, nodes, existing);
    return () => {
      assert.equal(output.status, 'routed');
      assert.deepEqual(output.points, [{ x: 100, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 260 }, { x: 400, y: 260 }]);
      assert.equal(output.length, 520);
      avoids(output.points, nodes, connection);
      respectsPorts(output, connection);
    };
  }
);

routingScenario(
  "the same crossing with and without a collinear subdivision",
  "the preview routes are compared across the subdivision",
  "subdividing a straight route cannot hide a real crossing",
  () => {
    const existing = { id: 'vertical', source: 'c', target: 'd', points: [{ x: 150, y: -40 }, { x: 150, y: 40 }] };
    const divided = { ...existing, points: [existing.points[0], { x: 150, y: 0 }, existing.points[1]] };
    const snapshot = structuredClone(divided);
    const expected = routeConnection(edge(), [], [existing]);
    return () => {
      assert.ok(expected.length > 300);
      assert.deepEqual(routeConnection(edge(), [], [divided]), expected);
      assert.deepEqual(divided, snapshot);
    };
  }
);

routingScenario(
  "clear paths with different possible bend counts",
  "the shortest orthogonal routes are selected",
  "equally short clear paths prefer fewer bends without seeking an earlier overlap",
  () => {
    const connection = edge({ sourcePosition: 'bottom', targetY: 200 });
    const output = route(connection);
    return () => {
      assert.deepEqual(output.points, [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }]);
      respectsPorts(output, connection);
      const parallel = edge({ targetY: 200 });
      assert.deepEqual(route(parallel).points, [
        { x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 200 }, { x: 300, y: 200 },
      ], 'equal bend counts keep the existing late turn');
    };
  }
);

routingScenario(
  "parallel route sections with matching endpoints and rotated equivalents",
  "new connections are aligned with the existing sections",
  "aligns parallel runs for more overlap without adding bends or length",
  () => {
    const nodes = [node('object', 0, 0, 100, 200), node('cast', 400, 240, 100, 80)];
    const connection = edge({ source: 'object', target: 'cast', sourceX: 100, sourceY: 40, targetX: 400, targetY: 260 });
    const existing = [{ id: 'lower', source: 'object', target: 'cast', points: [
      { x: 100, y: 140 }, { x: 360, y: 140 }, { x: 360, y: 260 }, { x: 400, y: 260 },
    ] }];
    const snapshot = structuredClone(existing);
    const output = routeConnection(connection, nodes, existing);
    return () => {
      assert.deepEqual(output.points, [{ x: 100, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 260 }, { x: 400, y: 260 }]);
      assert.equal(output.length, 520);
      avoids(output.points, nodes, connection);
      respectsPorts(output, connection);
      assert.deepEqual(existing, snapshot, 'existing arrows must stay fixed');

      const rotated = { ...connection, sourceX: 40, sourceY: 100, targetX: 260, targetY: 400,
        sourcePosition: 'bottom', targetPosition: 'top' };
      const rotatedNodes = nodes.map(({ x, y, width, height, ...rest }) => ({ ...rest, x: y, y: x, width: height, height: width }));
      const rotatedRoutes = existing.map((route) => ({ ...route, points: route.points.map(({ x, y }) => ({ x: y, y: x })) }));
      const horizontal = routeConnection(rotated, rotatedNodes, rotatedRoutes);
      assert.deepEqual(horizontal.points, output.points.map(({ x, y }) => ({ x: y, y: x })));
      avoids(horizontal.points, rotatedNodes, rotated);
      respectsPorts(horizontal, rotated);

      const lower = { ...connection, sourceY: 140 };
      const upper = [{ id: 'upper', source: 'object', target: 'cast', points: [
        { x: 100, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 260 }, { x: 400, y: 260 },
      ] }];
      assert.deepEqual(routeConnection(lower, nodes, upper).points, [
        { x: 100, y: 140 }, { x: 360, y: 140 }, { x: 360, y: 260 }, { x: 400, y: 260 },
      ], 'joining the middle of an existing line is an overlay, not a crossing');
    };
  }
);

routingScenario(
  "competing overlap choices and duplicate shorter arrows",
  "the overlap alignment is computed with and without duplicates",
  "duplicate overlapping arrows do not change the preferred alignment",
  () => {
    const connection = edge({ targetX: 400, targetY: 260 });
    const best = { id: 'b-longer-overlap', source: 'c', target: 'b', points: [
      { x: 100, y: 140 }, { x: 360, y: 140 }, { x: 360, y: 260 }, { x: 400, y: 260 },
    ] };
    const shorter = { id: 'a-shorter-overlap', source: 'd', target: 'b', points: [
      { x: 100, y: 180 }, { x: 340, y: 180 }, { x: 340, y: 260 }, { x: 400, y: 260 },
    ] };
    const output = routeConnection(connection, [], [best, shorter]);
    return () => {
      assert.deepEqual(output.points, [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 260 }, { x: 400, y: 260 }]);
      const duplicates = Array.from({ length: 4 }, (_, index) => ({ ...shorter, id: `duplicate-${index}` }));
      assert.deepEqual(routeConnection(connection, [], [...duplicates, best, shorter]), output);
    };
  }
);

routingScenario(
  "overlap opportunities that would add bends or intersect a node",
  "the overlap preference is applied to the constrained routes",
  "overlap preference never adds bends to a straight arrow or moves a route into a node",
  () => {
    const parallel = [{ id: 'parallel', source: 'c', target: 'd', points: [{ x: 50, y: 20 }, { x: 250, y: 20 }] }];
    const actual = routeConnection(edge(), [], parallel).points;
    return () => {
      assert.deepEqual(actual, [{ x: 0, y: 0 }, { x: 300, y: 0 }]);
      const connection = edge({ targetX: 400, targetY: 260 });
      const existing = [{ id: 'lower', source: 'c', target: 'b', points: [
        { x: 100, y: 140 }, { x: 360, y: 140 }, { x: 360, y: 260 }, { x: 400, y: 260 },
      ] }];
      const nodes = [node('blocker', 350, 30, 18, 50)];
      const output = routeConnection(connection, nodes, existing);
      assert.deepEqual(output.points, [{ x: 0, y: 0 }, { x: 380, y: 0 }, { x: 380, y: 260 }, { x: 400, y: 260 }]);
      avoids(output.points, nodes, connection);
    };
  }
);

routingScenario(
  "a complete scene with crossing edges and node obstacles",
  "the scene is routed in both node and edge iteration orders",
  "complete graphs route deterministically regardless of node or edge array order",
  () => {
    const nodes = [node('blocker2', 200, 100, 40, 30), node('blocker1', 80, -30, 40, 60)];
    const edges = [edge({ id: 'horizontal' }), edge({ id: 'vertical', source: 'c', target: 'd', sourceX: 150, sourceY: -80,
      targetX: 150, targetY: 80, sourcePosition: 'bottom', targetPosition: 'top' })];
    const snapshot = structuredClone({ nodes, edges });
    const first = routeEdges({ nodes, edges });
    const second = routeEdges({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
    return () => {
      assert.deepEqual(first, second);
      for (const connection of edges) avoids(first.get(connection.id).points, nodes, connection);
      assert.deepEqual({ nodes, edges }, snapshot);
    };
  }
);

routingScenario(
  "impossible obstacles and deliberately bounded search limits",
  "routes are calculated when detailed search cannot succeed",
  "impossible overlaps and explicitly bounded searches produce finite visible fallbacks",
  () => {
    const connection = edge();
    const overlap = route(connection, [node('overlap', -10, -10, 40, 40)]);
    return () => {
      assert.equal(overlap.status, 'fallback');
      assert.ok(overlap.points.length >= 2 && Number.isFinite(overlap.length));
      const limited = route(connection, [node('blocker', 100, -30, 100, 60)], { maxWork: 1 });
      assert.equal(limited.status, 'fallback');
      const gridLimited = route(connection, [node('blocker', 100, -30, 100, 60)], { maxGridPoints: 1 });
      assert.equal(gridLimited.status, 'fallback');
    };
  }
);

routingScenario(
  "one thousand nodes and four thousand connections",
  "the graph is routed with only two detailed routes allowed",
  "large graph limits bound detailed routing while preserving every connection",
  () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => node(`n${i}`, (i % 50) * 100, Math.floor(i / 50) * 100 + 500, 50, 50));
    const edges = Array.from({ length: 4000 }, (_, i) => edge({ id: `e${i}`, sourceY: i, targetY: i }));
    const output = routeEdges({ nodes, edges }, { maxWork: 1000, maxRoutedEdges: 2 });
    return () => {
      assert.equal(output.size, 4000);
      assert.ok([...output.values()].every((value) => value.points.length >= 2 && Number.isFinite(value.length)));
      assert.ok([...output.values()].filter((value) => value.status === 'routed').length <= 2);
    };
  }
);
