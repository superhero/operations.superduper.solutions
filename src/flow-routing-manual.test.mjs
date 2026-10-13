// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from 'node:assert/strict';
import { routingScenario } from './flow-routing-test-support.mjs';
import { normalizeManualRoute, segmentHandles, prepareSegmentDrag, moveSegment, resolveManualRoute } from './lib/flow-routing/manual.js';
import { routeConnection, routeEdges } from './lib/flow-routing/router.js';
import { routingScene } from './lib/flow-routing/geometry.js';
import { createRoutingSession } from './lib/flow-routing/session.js';

const p = (x, y) => ({ x, y });
const node = (id, x, y, width, height) => ({ id, x, y, width, height });
const edge = (values = {}) => ({ id: 'edge', source: 'a', target: 'b', sourceX: 0, sourceY: 0,
  targetX: 300, targetY: 0, sourcePosition: 'right', targetPosition: 'left', ...values });
const straight = { points: [p(0, 0), p(300, 0)] };
const elbow = { points: [p(0, 0), p(100, 0), p(100, 100), p(300, 100)] };
const elbowEdge = edge({ targetY: 100 });
const routeLength = points => points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
const scenario = (name, verify) => routingScenario(`manual routing fixture: ${name}`, `manual routing action: ${name}`, `manual routing guarantee: ${name}`, () => verify);

function valid(output, connection, nodes = [], options) {
  const normalized = normalizeManualRoute(output.points);
  assert.ok(normalized, 'the resulting polyline is valid');
  assert.equal(output.length, routeLength(output.points));
  assert.deepEqual(normalized[0], p(connection.sourceX, connection.sourceY));
  assert.deepEqual(normalized.at(-1), p(connection.targetX, connection.targetY));
  assert.ok(resolveManualRoute(normalized, connection, nodes, options), 'the moved path is still certified');
}

scenario('normalization clones exact orthogonal intent', () => {
  const input = [p(0, 0), { x: 0, y: 0, extra: true }, p(10, 0), p(20, 0), p(20, 10), p(20, 30)];
  const snapshot = structuredClone(input);
  const actual = normalizeManualRoute(input);
  assert.deepEqual(actual, [p(0, 0), p(20, 0), p(20, 30)]);
  assert.deepEqual(input, snapshot);
  actual[0].x = 2;
  assert.deepEqual(input, snapshot);
  assert.deepEqual(normalizeManualRoute([p(-1e6, -1e6), p(1e6, -1e6)]), [p(-1e6, -1e6), p(1e6, -1e6)]);
});

scenario('normalization rejects malformed and oversized input', () => {
  for (const input of [undefined, null, {}, [], [p(0, 0)], [p(0, 0), null], [p(0, 0), []],
    [p(0, 0), p(Infinity, 0)], [p(0, 0), p(0, NaN)], [p(0, 0), p(1e6 + 1, 0)], [p(0, 0), p(0, -1e6 - 1)],
    [p(0, 0), p(0, 0)], [p(0, 0), p(1, 1e-12)], [p(0, 0), p(10, 0), p(5, 0)],
    [p(0, 0), p(0, -10), p(0, -5)], Array.from({ length: 129 }, (_, x) => p(x, 0))]) {
    assert.equal(normalizeManualRoute(input), null);
  }
  assert.deepEqual(normalizeManualRoute(Array.from({ length: 128 }, (_, x) => p(x, 0))), [p(0, 0), p(127, 0)]);
});

scenario('every normalized straight run exposes its axis and midpoint', () => {
  assert.deepEqual(segmentHandles(elbow), [
    { index: 0, x: 50, y: 0, axis: 'y' }, { index: 1, x: 100, y: 50, axis: 'x' }, { index: 2, x: 200, y: 100, axis: 'y' },
  ]);
  assert.deepEqual(segmentHandles(straight), [{ index: 0, x: 150, y: 0, axis: 'y' }]);
  assert.deepEqual(segmentHandles(undefined), []);
  assert.deepEqual(segmentHandles({ points: [p(0, 0), p(1, 1)] }), []);
});

scenario('both interior axes move without mutating the captured route', () => {
  for (const rotated of [false, true]) {
    const transform = point => rotated ? p(point.y, point.x) : point;
    const route = { points: elbow.points.map(transform) };
    const connection = rotated ? edge({ targetX: 100, targetY: 300, sourcePosition: 'bottom', targetPosition: 'top' }) : elbowEdge;
    const snapshot = structuredClone(route);
    const drag = prepareSegmentDrag(route, 1, connection, []);
    const captured = structuredClone(drag);
    const moved = moveSegment(drag, 170.125);
    assert.equal(drag.axis, rotated ? 'y' : 'x');
    assert.deepEqual(moved.route.points, [p(0, 0), p(170.125, 0), p(170.125, 100), p(300, 100)].map(transform));
    assert.equal(moved.limited, false);
    valid(moved.route, connection);
    assert.deepEqual(drag, captured);
    assert.deepEqual(route, snapshot);
    assert.deepEqual(normalizeManualRoute(moveSegment(drag, drag.startCoordinate).route.points), drag.original);
    assert.equal(moveSegment(drag, NaN).coordinate, drag.startCoordinate);
  }
});

scenario('first last and single segments retain attached endpoint stubs in every direction', () => {
  const source = node('a', -50, -20, 50, 40), target = node('b', 300, 80, 50, 40);
  for (const rotated of [false, true]) for (const sign of [1, -1]) for (const index of [0, 2]) {
    const transform = point => rotated ? p(point.y * sign, point.x * sign) : p(point.x * sign, point.y * sign);
    const points = elbow.points.map(transform), start = points[0], end = points.at(-1);
    const connection = edge({ sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y,
      sourcePosition: rotated ? sign > 0 ? 'bottom' : 'top' : sign > 0 ? 'right' : 'left',
      targetPosition: rotated ? sign > 0 ? 'top' : 'bottom' : sign > 0 ? 'left' : 'right' });
    const nodes = [source, target].map(body => {
      const a = transform(body), b = transform(p(body.x + body.width, body.y + body.height));
      return node(body.id, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    });
    const drag = prepareSegmentDrag({ points }, index, connection, nodes);
    assert.ok(drag);
    assert.equal(drag.points.length, points.length + 2);
    for (const offset of [-30, 30]) valid(moveSegment(drag, drag.startCoordinate + offset).route, connection, nodes);
  }
  const nodes = [source, { ...target, y: -20 }];
  const drag = prepareSegmentDrag(straight, 0, edge(), nodes, { stubLength: 0 });
  assert.equal(drag.points.length, 6);
  for (const y of [-30, 30]) valid(moveSegment(drag, y).route, edge(), nodes);
  assert.deepEqual(normalizeManualRoute(moveSegment(drag, 0).route.points), straight.points);
});

scenario('a fast pointer cannot tunnel the selected run through a blocker', () => {
  const nodes = [node('blocker', 120, 80, 40, 40)];
  const drag = prepareSegmentDrag(straight, 0, edge(), nodes, { nodePadding: 12 });
  const moved = moveSegment(drag, 500);
  assert.equal(moved.coordinate, 68);
  assert.equal(moved.limited, true);
  assert.equal(moveSegment(drag, 50).coordinate, 50);
  valid(moved.route, edge(), nodes);
  const below = prepareSegmentDrag({ points: [p(0, 200), p(300, 200)] }, 0, edge({ sourceY: 200, targetY: 200 }), nodes);
  assert.equal(moveSegment(below, -500).coordinate, 132);
});

scenario('stretching connectors stop before blockers beyond the moving run', () => {
  const nodes = [node('blocker', 10, 80, 20, 30)];
  const drag = prepareSegmentDrag(straight, 0, edge(), nodes, { nodePadding: 0 });
  const moved = moveSegment(drag, 200);
  assert.equal(moved.coordinate, 80);
  valid(moved.route, edge(), nodes, { nodePadding: 0 });
  // The requested run at y=200 is clear, but its stretched x=20 connector
  // would cross the blocker between the fixed endpoint and that run.
  assert.equal(drag.points[drag.movingIndices[0]].x, 20);
});

scenario('exact obstacle boundary contact permits travel in both directions', () => {
  const nodes = [node('touch', 0, 30, 20, 50)];
  const drag = prepareSegmentDrag(straight, 0, edge(), nodes, { nodePadding: 0 });
  assert.equal(moveSegment(drag, 200).coordinate, 200);
  valid(moveSegment(drag, 200).route, edge(), nodes, { nodePadding: 0 });
  assert.equal(moveSegment(drag, -2e6).coordinate, -1e6);
  assert.equal(moveSegment(drag, 2e6).coordinate, 1e6);
});

scenario('owner clearance cannot be borrowed by an interior segment', () => {
  const nodes = [node('a', -50, -20, 50, 40), node('b', 300, 80, 50, 40)];
  const drag = prepareSegmentDrag(elbow, 1, elbowEdge, nodes);
  assert.equal(moveSegment(drag, -100).coordinate, 12);
  assert.equal(moveSegment(drag, 500).coordinate, 288);
  valid(moveSegment(drag, -100).route, elbowEdge, nodes);
  valid(moveSegment(drag, 500).route, elbowEdge, nodes);
});

scenario('a constrained terminal corridor shares the router clearance policy', () => {
  const nodes = [node('a', 400, 250, 220, 90), node('nearby', 630, 250, 220, 90), node('b', 80, 360, 220, 90)];
  const connection = edge({ sourceX: 625, sourceY: 316.5, targetX: 75, targetY: 381.5 });
  const route = routeConnection(connection, nodes);
  assert.ok(resolveManualRoute(route.points, connection, nodes));
  const drags = segmentHandles(route).map(handle => prepareSegmentDrag(route, handle.index, connection, nodes));
  assert.ok(drags.some(Boolean));
  for (const drag of drags.filter(Boolean)) valid(moveSegment(drag, drag.startCoordinate + 1000).route, connection, nodes);
});

scenario('a full clearance route keeps its original policy while dragging', () => {
  const nodes = [node('a', -50, -20, 50, 40), node('nearby', 10, 50, 20, 20)];
  const drag = prepareSegmentDrag(straight, 0, edge(), nodes);
  assert.equal(moveSegment(drag, 300).coordinate, 38);
  assert.equal(resolveManualRoute(moveSegment(drag, 300).route.points, edge(), nodes).manualState, 'applied');
});

scenario('invalid attachment and very short terminals cannot begin a drag', () => {
  for (const [route, index, connection] of [
    [straight, -1, edge()], [straight, 1, edge()], [straight, 0.5, edge()],
    [{ points: [] }, 0, edge()], [straight, 0, edge({ sourceX: 1 })], [straight, 0, edge({ sourceY: 1 })],
    [straight, 0, edge({ targetX: 299 })], [straight, 0, edge({ targetY: 1 })],
    [straight, 0, edge({ sourcePosition: 'top' })], [straight, 0, edge({ targetPosition: 'right' })],
  ]) assert.equal(prepareSegmentDrag(route, index, connection, []), null);
  const close = { points: [p(0, 0), p(24, 0)] };
  assert.equal(prepareSegmentDrag(close, 0, edge({ targetX: 24 }), [node('a', -50, -20, 50, 40), node('b', 24, -20, 50, 40)]), null);
  assert.equal(segmentHandles(close).length, 1, 'short terminal handles remain visible');
});

scenario('preparation and resolution fail closed when their work budget is exhausted', () => {
  const nodes = [node('blocker', 10, 80, 20, 30)];
  for (const maxWork of [0, 1, 4, 6, 10, 15, 20]) {
    assert.equal(prepareSegmentDrag(straight, 0, edge(), nodes, { maxWork }), null);
  }
  assert.equal(resolveManualRoute(straight.points, edge(), nodes, { maxWork: 0 }), null);
  assert.equal(resolveManualRoute(straight.points, edge(), nodes, { maxWork: 2 }), null);
  const blocked = [node('blocker', 100, -20, 50, 40)];
  assert.equal(prepareSegmentDrag(straight, 0, edge(), blocked, { maxWork: 5 }), null);
  assert.equal(prepareSegmentDrag(straight, 0, edge(), blocked, { maxWork: 6 }), null);
  assert.equal(prepareSegmentDrag(straight, 0, edge(), blocked, { nodePadding: 0 }), null);
  assert.equal(resolveManualRoute(straight.points, edge(), blocked), null);
  assert.ok(prepareSegmentDrag(straight, 0, edge(), [], { maxWork: NaN, nodePadding: -1, stubLength: Infinity }));
});

scenario('scratch topology respects the original point cap', () => {
  const points = [p(0, 0)];
  for (let index = 1; index < 128; index++) points.push(index % 2 ? p(points.at(-1).x + 10, points.at(-1).y) : p(points.at(-1).x, points.at(-1).y + 10));
  const last = points.at(-1), connection = edge({ targetX: last.x, targetY: last.y });
  assert.equal(prepareSegmentDrag({ points }, 0, connection, []), null);
  assert.ok(prepareSegmentDrag({ points }, 1, connection, []));
});

scenario('safe collinear collapse can reopen on the opposite side', () => {
  const route = { points: [p(0, 0), p(50, 0), p(50, 100), p(100, 100), p(100, 200), p(300, 200)] };
  const connection = edge({ targetY: 200 });
  const drag = prepareSegmentDrag(route, 2, connection, []);
  const moved = moveSegment(drag, -50);
  assert.equal(moved.coordinate, -50);
  valid(moved.route, connection);
  valid(moveSegment(drag, 0).route, connection);
  valid(moveSegment(drag, 250).route, connection);
});

scenario('opposite run collapse stops before a hairpin', () => {
  const route = { points: [p(0, 0), p(100, 0), p(100, 100), p(50, 100), p(50, 200), p(300, 200)] };
  const connection = edge({ targetY: 200 });
  const drag = prepareSegmentDrag(route, 2, connection, []);
  assert.equal(moveSegment(drag, -50).coordinate, 1e-6);
  assert.equal(moveSegment(drag, 250).coordinate, 200 - 1e-6);
  valid(moveSegment(drag, -50).route, connection);
  valid(moveSegment(drag, 250).route, connection);
});

scenario('simultaneous connector collapse checks the whole path and endpoint direction', () => {
  const route = { points: [p(0, 0), p(100, 0), p(100, 100), p(200, 100), p(200, 0), p(300, 0)] };
  const drag = prepareSegmentDrag(route, 2, edge(), []);
  assert.equal(moveSegment(drag, -50).coordinate, -50);
  valid(moveSegment(drag, 0).route, edge());
  const interior = prepareSegmentDrag(elbow, 1, elbowEdge, []);
  assert.equal(moveSegment(interior, -10).coordinate, 1e-6);
  assert.equal(moveSegment(interior, 500).coordinate, 300 - 1e-6);
});

scenario('manual intent is projected suspended and restored without mutation', () => {
  const points = [p(0, 0), p(20, 0), p(20, -60), p(280, -60), p(280, 0), p(300, 0)];
  const connection = edge({ manualRoute: points }), snapshot = structuredClone(connection);
  const initial = routeEdges({ nodes: [], edges: [connection] }).get(connection.id);
  assert.deepEqual(initial.points, points);
  assert.equal(initial.manualState, 'applied');
  const blocked = routeEdges({ nodes: [node('blocker', 100, -80, 50, 40)], edges: [connection] }).get(connection.id);
  assert.equal(blocked.manualState, 'suspended');
  assert.notDeepEqual(blocked.points, points);
  assert.deepEqual(routeEdges({ nodes: [], edges: [connection] }).get(connection.id), initial);
  const moved = resolveManualRoute(points, edge({ sourceY: 20, targetY: 20 }), []);
  assert.deepEqual(moved.points, points.map(point => p(point.x, point.y + 20)));
  assert.equal(resolveManualRoute(points, edge({ sourcePosition: 'top' }), []), null);
  assert.equal(resolveManualRoute([p(0, 0)], connection, []), null);
  assert.equal(resolveManualRoute(straight.points, edge({ sourceX: 1e6, targetX: 1e6 + 300 }), []), null);
  assert.deepEqual(connection, snapshot);
});

scenario('applied manual paths bypass crossing and overlap optimization', () => {
  const manual = edge({ manualRoute: straight.points });
  const crossing = edge({ id: 'crossing', source: 'c', target: 'd', sourceX: 150, targetX: 150,
    sourceY: -40, targetY: 40, sourcePosition: 'bottom', targetPosition: 'top' });
  const output = routeEdges({ nodes: [], edges: [manual, crossing] });
  assert.deepEqual(output.get('edge').points, straight.points);
  assert.equal(output.get('edge').manualState, 'applied');
  assert.equal('manualState' in output.get('crossing'), false);
  const preview = routeConnection(manual, [], [{ id: crossing.id, points: [p(150, -40), p(150, 40)] }]);
  assert.deepEqual(preview.points, straight.points);
  assert.equal(preview.manualState, 'applied');
  assert.equal(routeConnection(edge({ manualRoute: [] }), []).manualState, 'suspended');
  assert.equal(routeEdges({ nodes: [], edges: [manual] }, { maxWork: 0 }).get('edge').manualState, 'suspended');
});

scenario('invalid nodes are ignored consistently during manual certification', () => {
  const nodes = [node('invalid', NaN, 0, 20, 20), node('empty', 0, 0, 0, 20), node('negative', 0, 0, 20, -1)];
  assert.ok(prepareSegmentDrag(straight, 0, edge(), nodes));
  assert.ok(resolveManualRoute(straight.points, edge(), nodes));
});

scenario('scene adapters clone authored points and invalidate worker cache keys', () => {
  const internals = [
    { id: 'a', measured: { width: 50, height: 40 }, internals: { positionAbsolute: p(-50, -20), handleBounds: { source: [{ id: 'out', position: 'right', x: 50, y: 20, width: 0, height: 0 }], target: [] } } },
    { id: 'b', measured: { width: 50, height: 40 }, internals: { positionAbsolute: p(300, -20), handleBounds: { source: [], target: [{ id: 'in', position: 'left', x: 0, y: 20, width: 0, height: 0 }] } } },
  ];
  const original = { id: 'edge', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', manualRoute: straight.points };
  const scene = routingScene(internals, [original], id => internals.find(node => node.id === id));
  assert.deepEqual(scene.edges[0].manualRoute, straight.points);
  assert.notEqual(scene.edges[0].manualRoute, straight.points);
  assert.notEqual(scene.edges[0].manualRoute[0], straight.points[0]);
  const session = createRoutingSession();
  const first = session.calculate({ sceneRevision: 1, scene, preview: null, options: {} }).routes;
  assert.equal(first.get('edge').manualState, 'applied');
  const adjusted = [p(0, 0), p(20, 0), p(20, 30), p(280, 30), p(280, 0), p(300, 0)];
  const second = session.calculate({ sceneRevision: 2, scene: { ...scene, edges: [{ ...scene.edges[0], manualRoute: adjusted }] }, preview: null, options: {} }).routes;
  assert.notDeepEqual(first.get('edge').points, second.get('edge').points);
});

scenario('tolerance-only obstacle clearance cannot snap a drag on pointer down', () => {
  // Automatic intersection checks tolerate 1e-7; exact interval construction
  // cannot certify travel from inside that sliver and conservatively declines.
  assert.equal(prepareSegmentDrag(straight, 0, edge(), [node('sliver', 100, -5e-8, 40, 40)], { nodePadding: 0 }), null);
  assert.equal(prepareSegmentDrag(elbow, 2, elbowEdge, [node('sliver', 100 - 5e-8, -1, 1e-7, 2)], { nodePadding: 0 }), null);
  assert.equal(prepareSegmentDrag(elbow, 2, elbowEdge, [node('sliver', 100 - 5e-8, 10, 1e-7, 10)], { nodePadding: 0 }), null);
});

scenario('a body-only fallback never becomes editable by discarding requested clearance', () => {
  const nodes = [node('s', 0, 0, 100, 100), node('B1', 138, 28, 27, 36), node('B2', 94, 2, 29, 46), node('B3', 97, 86, 55, 15)];
  const connection = edge({ source: 's', target: 't', sourceX: 105, sourceY: 50, targetX: 395, targetY: 150 });
  const route = routeConnection(connection, nodes);
  assert.equal(route.status, 'fallback');
  assert.equal(resolveManualRoute(route.points, connection, nodes), null);
  for (const handle of segmentHandles(route)) assert.equal(prepareSegmentDrag(route, handle.index, connection, nodes), null);
});

scenario('successive segment edits adopt only the latest normalized geometry', () => {
  const first = prepareSegmentDrag(straight, 0, edge(), []);
  const before = structuredClone(first);
  const moved = normalizeManualRoute(moveSegment(first, 70).route.points);
  const second = prepareSegmentDrag({ points: moved }, 1, edge(), []);
  assert.ok(second);
  const edited = moveSegment(second, 40);
  valid(edited.route, edge());
  const saved = normalizeManualRoute(edited.route.points);
  assert.deepEqual(saved, [p(0, 0), p(40, 0), p(40, 70), p(280, 70), p(280, 0), p(300, 0)]);
  assert.deepEqual(first, before);
  assert.deepEqual(normalizeManualRoute(moveSegment(second, second.startCoordinate).route.points), moved);
});

scenario('deterministic obstructed scenes retain valid clearance throughout captured gestures', () => {
  let seed = 3911, prepared = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let sample = 0; sample < 300; sample++) {
    const connection = edge({ targetY: Math.floor(random() * 300) - 150 });
    const nodes = Array.from({ length: 4 }, (_, index) => node(String(index), Math.floor(random() * 320) - 10,
      Math.floor(random() * 320) - 160, 10 + Math.floor(random() * 60), 10 + Math.floor(random() * 60)));
    const route = routeConnection(connection, nodes);
    for (const handle of segmentHandles(route)) {
      const drag = prepareSegmentDrag(route, handle.index, connection, nodes);
      if (!drag) continue;
      prepared++;
      for (const coordinate of [drag.low, drag.high, drag.startCoordinate, -1000, 1000, drag.startCoordinate + (random() - 0.5) * 500]) {
        valid(moveSegment(drag, coordinate).route, connection, nodes);
      }
    }
  }
  assert.ok(prepared > 900, 'the fixed seed covers hundreds of movable segment topologies');
});
