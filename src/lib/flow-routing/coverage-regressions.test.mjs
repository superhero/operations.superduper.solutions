// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { routingScenario } from "../../flow-routing-test-support.mjs";
import { routeConnection, routeEdges } from "./router.js";
import { matchesEndpoints, projectRoute, routeMidpoint } from "./path.js";
import { roundedSegments } from "./rounding.js";

const edge = (values = {}) => ({ id: "edge", source: "a", target: "b", sourceX: 0, sourceY: 0,
  targetX: 300, targetY: 0, sourcePosition: "right", targetPosition: "left", ...values });
const point = (x, y) => ({ x, y });
const node = (id, x, y, width, height) => ({ id, x, y, width, height });

routingScenario(
  "four connections whose crossing avoidance clears an earlier direct corridor",
  "the complete scene finishes crossing reduction",
  "the obsolete loop returns to its short clear route without moving authored anchors",
  () => {
    const nodes = [node('a', 0, 80, 150, 180), node('b', 250, -180, 180, 220),
      node('e', 490, 260, 280, 220), node('f', 520, 550, 220, 100)];
    const connection = (id, source, target, sourceX, sourceY, targetX, targetY) =>
      edge({ id, source, target, sourceX, sourceY, targetX, targetY });
    const edges = [connection('e0', 'a', 'e', 150, 130, 490, 280),
      connection('e2', 'b', 'f', 430, -40, 520, 570),
      connection('e4', 'e', 'a', 770, 370, 0, 100), connection('e5', 'b', 'e', 430, -70, 490, 280)];
    const options = { nodePadding: 16 }, scene = { nodes, edges }, snapshot = structuredClone(scene);
    const routes = routeEdges(scene, options);
    const manualRoute = [point(430, -40), point(450, -40), point(450, 64), point(-20, 64),
      point(-20, 590), point(450, 590), point(450, 570), point(520, 570)];
    const authored = routeEdges({ nodes, edges: edges.map(edge => edge.id === 'e2' ? { ...edge, manualRoute } : edge) }, options);
    return () => {
      assert.equal(routes.get('e2').length, 700, 'the former 1680-unit detour has a clear 700-unit alternative');
      assert.equal(routes.get('e2').points.length, 4);
      for (const edge of edges) {
        const route = routes.get(edge.id);
        completeRoute(route, edge);
        for (const node of nodes) clearOfNode(route.points, node, 16,
          [...(node.id === edge.source ? [1] : []), ...(node.id === edge.target ? [route.points.length - 1] : [])]);
      }
      assert.deepEqual(routeEdges({ nodes: nodes.toReversed(), edges: edges.toReversed() }, options), routes);
      assert.equal(authored.get('e2').manualState, 'applied');
      assert.deepEqual(authored.get('e2').points, manualRoute);
      assert.deepEqual(scene, snapshot);
    };
  }
);

function completeRoute(route, connection) {
  assert.ok(["routed", "fallback"].includes(route.status));
  assert.ok(Number.isFinite(route.length));
  assert.deepEqual(route.points[0], point(connection.sourceX, connection.sourceY));
  assert.deepEqual(route.points.at(-1), point(connection.targetX, connection.targetY));
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(a.x === b.x || a.y === b.y);
  }
}

function clearOfNode(points, node, padding, except = []) {
  for (let index = 1; index < points.length; index++) {
    if (except.includes(index)) continue;
    const a = points[index - 1], b = points[index];
    const collision = a.x === b.x
      ? a.x > node.x - padding && a.x < node.x + node.width + padding &&
        Math.max(a.y, b.y) > node.y - padding && Math.min(a.y, b.y) < node.y + node.height + padding
      : a.y > node.y - padding && a.y < node.y + node.height + padding &&
        Math.max(a.x, b.x) > node.x - padding && Math.min(a.x, b.x) < node.x + node.width + padding;
    assert.equal(collision, false, `segment ${index} enters ${node.id}'s ${padding}-unit clearance`);
  }
}

const narrowNodes = [node("a", 400, 250, 220, 90), node("nearby", 630, 250, 220, 90), node("b", 80, 360, 220, 90)];
const narrowEdge = edge({ sourceX: 625, sourceY: 316.5, targetX: 75, targetY: 381.5, targetPosition: "left" });

routingScenario(
  "a narrow handle exit beside a node and a target behind it",
  "clearance is varied and the same scene is reflected and rotated",
  "unconstrained source faces and every nonterminal target segment retain the requested clearance",
  () => {
    const samples = [];
    for (const nodePadding of [0, 12, 36, 128]) for (const swapped of [false, true]) for (const sign of [1, -1]) {
      const transform = ({ x, y }) => swapped ? point(y * sign, x * sign) : point(x * sign, y * sign);
      const inverse = value => transform(value);
      const from = transform(point(narrowEdge.sourceX, narrowEdge.sourceY));
      const to = transform(point(narrowEdge.targetX, narrowEdge.targetY));
      const nodes = narrowNodes.map(body => {
        const a = transform(body), b = transform(point(body.x + body.width, body.y + body.height));
        return node(body.id, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      });
      const connection = { ...narrowEdge, sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y,
        sourcePosition: swapped ? sign > 0 ? "bottom" : "top" : sign > 0 ? "right" : "left",
        targetPosition: swapped ? sign > 0 ? "top" : "bottom" : sign > 0 ? "left" : "right" };
      const route = routeConnection(connection, nodes, [], { nodePadding });
      samples.push({ nodePadding, route, connection, canonical: route.points.map(inverse) });
    }
    return () => {
      for (const { nodePadding, route, connection, canonical } of samples) {
        completeRoute(route, connection);
        assert.equal(route.status, "routed");
        clearOfNode(canonical, narrowNodes[2], nodePadding, [canonical.length - 1]);
        // The first bend must escape the narrow terminal corridor. Once the
        // route travels over or under its source, the full buffer remains.
        for (let index = 1; index < canonical.length; index++) {
          const a = canonical[index - 1], b = canonical[index];
          if (a.y !== b.y || Math.max(a.x, b.x) <= 400 || Math.min(a.x, b.x) >= 620) continue;
          assert.ok(a.y <= 250 - nodePadding || a.y >= 340 + nodePadding);
        }
      }
    };
  }
);

routingScenario(
  "a narrow terminal and an existing route hugging the target boundary",
  "crossing reduction and shared-line alignment run at several clearances",
  "the new connection retains its target clearance while the existing route stays unchanged",
  () => {
    const existing = [{ id: "old", source: "a", target: "b", points: [point(625, 316.5), point(630, 316.5),
      point(630, 360), point(55, 360), point(55, 381.5), point(75, 381.5)] }];
    const snapshot = structuredClone(existing);
    const samples = [12, 36, 128].map(nodePadding => ({ nodePadding,
      route: routeConnection(narrowEdge, narrowNodes, existing, { nodePadding }) }));
    return () => {
      for (const { nodePadding, route } of samples) {
        completeRoute(route, narrowEdge);
        assert.equal(route.status, "routed");
        clearOfNode(route.points, narrowNodes[2], nodePadding, [route.points.length - 1]);
      }
      assert.deepEqual(existing, snapshot);
    };
  }
);

routingScenario(
  "measured endpoint bodies and a corner beside a clearance buffer",
  "routing and rounding use clearances larger than the preferred stub",
  "terminal stems reach the buffer boundary and only safe corners are rounded",
  () => {
    const nodes = [node("a", 0, 0, 100, 100), node("b", 500, 150, 100, 100)];
    const connection = edge({ sourceX: 100, sourceY: 50, targetX: 500, targetY: 200 });
    const routes = [36, 128].map(nodePadding => ({ nodePadding, route: routeConnection(connection, nodes, [], { nodePadding }) }));
    const obstacle = node("blocker", 100, -30, 100, 60), padding = 36;
    const expanded = { ...obstacle, x: obstacle.x - padding, y: obstacle.y - padding,
      width: obstacle.width + padding * 2, height: obstacle.height + padding * 2 };
    const route = { points: [point(0, 0), point(64, 0), point(64, -66), point(300, -66), point(300, 0)] };
    const segments = roundedSegments(route, 4, [expanded]);
    return () => {
      for (const { nodePadding, route } of routes) {
        assert.equal(route.status, "routed");
        clearOfNode(route.points, nodes[0], nodePadding, [1]);
        clearOfNode(route.points, nodes[1], nodePadding, [route.points.length - 1]);
      }
      assert.ok(segments.some(segment => segment.center), "Unconstrained corners still round.");
      assert.ok(segments.some(segment => !segment.center && segment.to.x === 64 && segment.to.y === -66),
        "A corner that would cut through the requested clearance remains sharp.");
      for (const segment of segments.filter(segment => segment.center)) {
        const start = Math.atan2(segment.from.y - segment.center.y, segment.from.x - segment.center.x);
        for (let step = 0; step <= 40; step++) {
          const angle = start + (segment.sweep ? 1 : -1) * Math.PI / 2 * step / 40;
          const p = point(segment.center.x + segment.radius * Math.cos(angle), segment.center.y + segment.radius * Math.sin(angle));
          assert.ok(p.x <= expanded.x || p.x >= expanded.x + expanded.width || p.y <= expanded.y || p.y >= expanded.y + expanded.height);
        }
      }
    };
  }
);

routingScenario(
  "a source handle inside an overlapping node body",
  "the obstructing body moves away to leave a narrow exit",
  "the impossible overlap falls back visibly and the separated bodies regain a checked route",
  () => {
    const connection = edge({ sourceX: 100, sourceY: 50, targetY: 50 });
    const nodes = [node("a", 0, 0, 100, 100), node("b", 300, 0, 100, 100), node("overlap", 50, 0, 100, 100)];
    const snapshot = structuredClone(nodes);
    const impossible = routeConnection(connection, nodes);
    const separated = nodes.map(body => body.id === "overlap" ? { ...body, x: 120 } : body);
    const recovered = routeConnection(connection, separated);
    return () => {
      assert.equal(impossible.status, "fallback");
      completeRoute(impossible, connection);
      assert.equal(recovered.status, "routed");
      completeRoute(recovered, connection);
      for (const body of separated) clearOfNode(recovered.points, body, 0,
        body.id === "a" ? [1] : body.id === "b" ? [recovered.points.length - 1] : []);
      assert.deepEqual(nodes, snapshot);
    };
  }
);

routingScenario(
  "a narrow corridor enclosed by overlapping source and blocker buffers",
  "clearance-preserving searches fail and the remaining work is bounded",
  "the last resort avoids node bodies without enabling clearance-losing optimization",
  () => {
    const nodes = [node("s", 0, 0, 100, 100), node("B1", 138, 28, 27, 36),
      node("B2", 94, 2, 29, 46), node("B3", 97, 86, 55, 15)];
    const connection = edge({ source: "s", target: "t", sourceX: 105, sourceY: 50, targetX: 395, targetY: 150 });
    const route = routeConnection(connection, nodes, [], { nodePadding: 12 });
    const existing = [{ id: "crossing", points: [point(140, 50), point(140, 180)] }];
    const unchanged = routeConnection(connection, nodes, existing, { nodePadding: 12 });
    const bounded = [0, 1, 20].map(maxWork => routeConnection(connection, nodes, existing, { nodePadding: 12, maxWork }));
    return () => {
      assert.equal(route.status, "fallback", "A route without requested clearance must not re-enter optimization.");
      completeRoute(route, connection);
      for (const body of nodes) clearOfNode(route.points, body, 0, body.id === "s" ? [1] : []);
      assert.deepEqual(unchanged, route, "Existing lines must not alter the checked last resort.");
      for (const limited of bounded) {
        assert.equal(limited.status, "fallback");
        completeRoute(limited, connection);
      }
    };
  }
);

routingScenario(
  "endpoints containing non-finite diagram coordinates",
  "invalid endpoint routes are requested through both entry points",
  "invalid endpoints return empty fallback geometry",
  () => {
    const routes = [NaN, Infinity, -Infinity].flatMap(value =>
      ["sourceX", "sourceY", "targetX", "targetY"].flatMap(key => {
        const connection = edge({ [key]: value });
        return [routeConnection(connection, []), routeEdges({ nodes: [], edges: [connection] }).get(connection.id)];
      }));
    return () => {
      for (const route of routes) assert.deepEqual(route, { points: [], length: 0, status: "fallback" });
    };
  }
);

routingScenario(
  "invalid routing budgets and omitted port directions",
  "default and defensive routing behavior are compared",
  "invalid options use defaults and absent directions retain visible fallback paths",
  () => {
    const nodes = [node("blocker", 100, -30, 100, 60)];
    const connection = edge();
    const expected = routeConnection(connection, nodes);
    const options = [NaN, Infinity, -1].map(value => Object.fromEntries(
      ["nodePadding", "stubLength", "maxLengthRatio", "maxGridPoints", "maxWork", "maxRoutedEdges"].map(name => [name, value])));
    const results = options.map(option => routeConnection(connection, nodes, [], option));
    const absent = edge({ sourcePosition: undefined, targetPosition: undefined });
    const defensive = [routeConnection(absent, []), routeConnection(absent, nodes, [], { maxWork: 0 })];
    return () => {
      for (const actual of results) assert.deepEqual(actual, expected);
      for (const actual of defensive) completeRoute(actual, absent);
      assert.equal(defensive[1].status, "fallback");
      assert.deepEqual(routeConnection(connection, nodes, [], { maxLengthRatio: 0 }),
        routeConnection(connection, nodes, [], { maxLengthRatio: 1 }));
    };
  }
);

routingScenario(
  "crossing and overlapping routes with small work budgets",
  "every bounded budget is exercised across routing phases",
  "bounded routing preserves endpoints and does not mutate existing routes",
  () => {
    const connection = edge({ targetX: 400, targetY: 260 });
    const existing = [
      { id: "lower", points: [point(100, 140), point(360, 140), point(360, 260), point(400, 260)] },
      { id: "upper", points: [point(100, 180), point(340, 180), point(340, 260), point(400, 260)] },
      { id: "crossing", points: [point(150, -40), point(150, 300)] },
    ];
    const nodes = [node("nearby", 350, 30, 18, 50)];
    const snapshot = structuredClone(existing);
    const results = [];
    for (let maxWork = 0; maxWork <= 400; maxWork++) {
      for (const routes of [existing, existing.slice(0, 2)]) {
        results.push(routeConnection(connection, nodes, routes, { maxWork }));
      }
    }
    return () => {
      for (const actual of results) completeRoute(actual, connection);
      assert.ok(results.some(route => route.status === "fallback"));
      assert.ok(results.some(route => route.status === "routed"));
      assert.deepEqual(existing, snapshot);
    };
  }
);

routingScenario(
  "crossing routes with distant segments and restricted search grids",
  "crossing searches run with zero padding and small grids",
  "restricted searches retain finite complete routes",
  () => {
    const connection = edge();
    const existing = [
      { id: "crossing", points: [point(150, -40), point(150, 40)] },
      { id: "distant", points: [point(0, 5000), point(200, 5000)] },
    ];
    const results = [1, 20, 30, 40, 100].flatMap(maxGridPoints =>
      [0, 12].map(nodePadding => routeConnection(connection, [], existing, { maxGridPoints, nodePadding })));
    results.push(routeConnection(connection, [node("blocker", 100, -30, 100, 60)], [], { nodePadding: 0, maxGridPoints: 1 }));
    return () => {
      for (const route of results) completeRoute(route, connection);
      assert.equal(results.at(-1).status, "fallback");
      assert.ok(results.some(route => route.length === 300));
    };
  }
);

routingScenario(
  "sharp multi-leg paths and an anticlockwise bend",
  "their midpoint and degenerate geometry are evaluated",
  "midpoint geometry follows the drawn path and empty routes have no midpoint",
  () => {
    const sharp = routeMidpoint({ points: [point(0, 0), point(10, 0), point(10, 90)], length: 100 });
    const curved = routeMidpoint({ points: [point(0, 0), point(20, 0), point(20, -20)], length: 40 }, 8);
    const repeated = routeMidpoint({ points: [point(4, 5), point(4, 5)], length: 0 }, 4);
    const empty = routeMidpoint({ points: [], length: 0 }, 4);
    return () => {
      assert.deepEqual(sharp, point(10, 40));
      assert.ok(Math.abs(curved.x - (12 + 8 / Math.sqrt(2))) < 1e-10);
      assert.ok(Math.abs(curved.y - (-8 + 8 / Math.sqrt(2))) < 1e-10);
      assert.deepEqual(repeated, point(4, 5));
      assert.equal(empty, undefined);
    };
  }
);

routingScenario(
  "mirrored shared-input bends and equally distant overlap choices",
  "reflected connections and reordered overlap choices are routed",
  "joins keep their shortest length and tied overlap choices remain stable",
  () => {
    const reflected = [];
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const connection = edge({ sourceX: 100 * sx, sourceY: 40 * sy, targetX: 400 * sx, targetY: 260 * sy,
        sourcePosition: sx > 0 ? "right" : "left", targetPosition: sx > 0 ? "left" : "right" });
      const existing = [{ id: "lower", points: [point(100 * sx, 140 * sy), point(380 * sx, 140 * sy),
        point(380 * sx, 260 * sy), point(400 * sx, 260 * sy)] }];
      reflected.push({ connection, route: routeConnection(connection, [], existing) });
      const through = [{ id: "through", points: [point(380 * sx, 140 * sy), point(380 * sx, 300 * sy)] }];
      reflected.push({ connection, route: routeConnection(connection, [], through) });
    }
    const connection = edge({ targetX: 400, targetY: 260 });
    const choices = [
      { id: "right", points: [point(400, 80), point(400, 260)] },
      { id: "left", points: [point(360, 80), point(360, 260)] },
    ];
    const first = routeConnection(connection, [], choices);
    const reversed = routeConnection(connection, [], [...choices].reverse());
    return () => {
      for (const { connection, route } of reflected) {
        completeRoute(route, connection);
        assert.equal(route.length, 520);
        assert.equal(route.points.length, 4);
      }
      assert.deepEqual(first, reversed);
      assert.deepEqual(first.points, [point(0, 0), point(360, 0), point(360, 260), point(400, 260)]);
    };
  }
);

routingScenario(
  "a tempting shared run with a crossing on its approach",
  "interior segment alignment considers the shared run",
  "the existing clear route is retained instead of adding a crossing",
  () => {
    const connection = edge({ targetX: 400, targetY: 260 });
    const existing = [
      { id: "lower", points: [point(100, 140), point(360, 140), point(360, 260), point(400, 260)] },
      { id: "crossing", points: [point(350, 80), point(370, 80)] },
    ];
    const actual = routeConnection(connection, [], existing);
    return () => {
      completeRoute(actual, connection);
      assert.deepEqual(actual.points, [point(0, 0), point(380, 0), point(380, 260), point(400, 260)]);
    };
  }
);

routingScenario(
  "a checked preview and completed edges with stable or moved endpoints",
  "endpoint compatibility is checked before preview handoff",
  "only the exact completed edge accepts the preview geometry",
  () => {
    const connection = edge();
    const route = routeConnection(connection, []);
    const matching = matchesEndpoints(route, { ...connection, id: "completed" });
    const stale = ["sourceX", "sourceY", "targetX", "targetY"].map(key =>
      matchesEndpoints(route, { ...connection, [key]: connection[key] + 1 }));
    const missing = [null, undefined, { points: [] }].map(route => matchesEndpoints(route, connection));
    return () => {
      assert.equal(matching, true);
      assert.deepEqual(stale, [false, false, false, false]);
      assert.deepEqual(missing, [false, false, false]);
    };
  }
);

routingScenario(
  "cached paths whose moving endpoints collapse their approaches",
  "both endpoint projections and finite precision limits are evaluated",
  "invalid local projections are rejected without mutating cached points",
  () => {
    const route = { points: [point(0, 0), point(100, 0), point(100, 100)], length: 200, status: "routed" };
    const snapshot = structuredClone(route);
    const target = projectRoute(route, edge({ targetX: -20, targetY: 100, targetPosition: "top" }));
    const source = projectRoute(route, edge({ sourceY: 120, targetX: 100, targetY: 100, targetPosition: "top" }));
    const large = { points: [point(1e17, 0), point(1e17 + 16, 0)], length: 16 };
    const precision = projectRoute(large, edge({ sourceX: 1e17, targetX: 1e17 - 16, targetY: 20 }));
    const hairpin = { points: [point(0, 1e17), point(20, 1e17), point(20, 1e17 + 64),
      point(-120, 1e17 + 64), point(-120, 1e17 + 32), point(-100, 1e17 + 32)] };
    const collapsed = projectRoute(hairpin, edge({ sourceY: 1e17, targetX: -100, targetY: 1e17 + 64 }));
    return () => {
      assert.equal(target, null);
      assert.equal(source, null);
      assert.equal(precision, null);
      assert.equal(collapsed, null);
      assert.deepEqual(route, snapshot);
    };
  }
);
