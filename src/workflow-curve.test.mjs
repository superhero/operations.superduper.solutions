// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { workflowCurve } from './lib/workflow-curve.ts';
import { routeEdges } from './lib/flow-routing/router.js';
import { bezierDrawing } from './lib/flow-routing/bezier.ts';

Then('flowing curves match the geometry before obstacle routing and manual anchors', () => {
  // Frozen results from b68904b (before routing #199 and manual anchors #200).
  for (const [sourcePosition, targetX, targetY, targetPosition, expected] of [
    ['right', 200, 100, 'left', ['M0,0 C200,0 0,100 200,100', 100, 50]],
    ['right', -100, 100, 'left', ['M0,0 C125,0 -225,100 -100,100', -50, 50]],
    ['bottom', 100, 200, 'top', ['M0,0 C0,200 100,0 100,200', 50, 100]],
  ]) assert.deepEqual(workflowCurve({ sourceX: 0, sourceY: 0, sourcePosition, targetX, targetY, targetPosition }, 100), expected);
});

Then('workflow curves follow every port orientation and keep their label at the cubic midpoint', () => {
  for (const [sourcePosition, targetPosition, targetX, targetY, expected] of [
    ['right', 'left', 200, 100, ['M0,0 C100,0 100,100 200,100', 100, 50]],
    ['left', 'right', -200, 100, ['M0,0 C-100,0 -100,100 -200,100', -100, 50]],
    ['bottom', 'top', 100, 200, ['M0,0 C0,100 100,100 100,200', 50, 100]],
    ['top', 'bottom', 100, -200, ['M0,0 C0,-100 100,-100 100,-200', 50, -100]],
  ]) {
    const points = { sourceX: 0, sourceY: 0, sourcePosition, targetX, targetY, targetPosition };
    assert.deepEqual(workflowCurve(points, 50), expected);
    assert.equal(workflowCurve(points, 0)[0], `M0,0 C0,0 ${targetX},${targetY} ${targetX},${targetY}`);
  }
});

Then('backward workflow connections bow out farther with increased curve strength', () => {
  const points = { sourceX: 0, sourceY: 0, sourcePosition: 'right', targetX: -100, targetY: 100, targetPosition: 'left' };
  assert.deepEqual(workflowCurve(points, 50), ['M0,0 C62.5,0 -162.5,100 -100,100', -50, 50]);
  assert.deepEqual(workflowCurve(points, 100), ['M0,0 C125,0 -225,100 -100,100', -50, 50]);
});

const cubics = path => {
  const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  const curves = [];
  let start = { x: values[0], y: values[1] };
  for (let i = 2; i < values.length; i += 6) {
    const end = { x: values[i + 4], y: values[i + 5] };
    curves.push([start, { x: values[i], y: values[i + 1] }, { x: values[i + 2], y: values[i + 3] }, end]); start = end;
  }
  return curves;
};
const at = (curve, t) => Object.fromEntries(['x', 'y'].map(axis => [axis, (1-t)**3*curve[0][axis] + 3*(1-t)**2*t*curve[1][axis] + 3*(1-t)*t*t*curve[2][axis] + t**3*curve[3][axis]]));

Then('curved routing keeps assertion return paths outside nodes at every strength', () => {
  const nodes = [{ id: 'filter', x: 40, y: 100, width: 300, height: 224 },
    { id: 'assert', x: 500, y: 140, width: 300, height: 180 },
    { id: 'blocker', x: 360, y: 330, width: 100, height: 100 }];
  const edge = (id, source, target, sourceX, sourceY, targetX, targetY) => ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition: 'right', targetPosition: 'left' });
  const edges = [edge('assertion', 'filter', 'assert', 340, 204, 500, 161),
    edge('keep', 'assert', 'filter', 800, 258, 40, 238), edge('remove', 'assert', 'filter', 800, 290, 40, 270)];
  const routes = routeEdges({ nodes, edges }, { nodePadding: 16 });
  const before = structuredClone([...routes]);
  for (const style of ['filleted', 'bezier', 'clutter']) for (const strength of [0, 50, 100, 200]) for (const link of edges) {
    const route = routes.get(link.id);
    assert.equal(route.status, 'routed');
    const result = bezierDrawing(route, link, strength, nodes.map(node => ({ ...node, x: node.x - 16, y: node.y - 16, width: node.width + 32, height: node.height + 32 })), false, style);
    const curves = cubics(result.path);
    assert.deepEqual(curves[0][0], { x: link.sourceX, y: link.sourceY });
    assert.deepEqual(curves.at(-1).at(-1), { x: link.targetX, y: link.targetY });
    for (const curve of curves) for (let i = 0; i <= 100; i++) {
      const point = at(curve, i / 100);
      if (link.id !== 'assertion') assert.ok(point.x >= Math.min(...route.points.map(p => p.x)) - 64.01 && point.x <= Math.max(...route.points.map(p => p.x)) + 64.01 &&
        point.y >= Math.min(...route.points.map(p => p.y)) - 64.01 && point.y <= Math.max(...route.points.map(p => p.y)) + 64.01, 'A detour must not create an unbounded loop outside its routed corridor.');
      for (const node of nodes) assert.ok(!(point.x > node.x + 1e-6 && point.x < node.x + node.width - 1e-6 && point.y > node.y + 1e-6 && point.y < node.y + node.height - 1e-6), `${link.id} at strength ${strength} must not cross ${node.id}.`);
    }
  }
  assert.deepEqual([...routes], before, 'Drawing must not rewrite derived or authored anchors.');
});

Then('routed curves restore diagonal Beziers and retain authored steering points', () => {
  const edge = { sourceX: 0, sourceY: 0, sourcePosition: 'right', targetX: 400, targetY: 200, targetPosition: 'left' };
  const route = { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 400, y: 200 }], length: 600, status: 'routed' };
  const before = structuredClone(route);
  for (const strength of [0, 50, 100, 200]) {
    const result = bezierDrawing(route, edge, strength, []);
    assert.equal(result.path, workflowCurve(edge, strength)[0], 'A clear connection must retain the original diagonal cubic, not rounded orthogonal elbows.');
    const actual = result.locate({ x: 200, y: 100 });
    assert.ok(Math.hypot(actual.x - 200, actual.y - 100) < 0.1, 'Visible anchor controls stay on the diagonal stroke.');
  }
  const authored = bezierDrawing(route, edge, 100, [], true);
  assert.notEqual(authored.path, workflowCurve(edge, 100)[0], 'Authored steering points must affect the shape.');
  for (const point of [{ x: 100, y: 0 }, { x: 200, y: 100 }, { x: 300, y: 200 }]) {
    const located = authored.locate(point);
    assert.ok(Math.hypot(located.x - point.x, located.y - point.y) < 0.1);
  }
  assert.deepEqual(route, before);
});

Then('curved drawings project off-stroke controls and retain bounded quadratic extrema', () => {
  const edge = { sourceX: 0, sourceY: 0, sourcePosition: 'right', targetX: 200, targetY: 100, targetPosition: 'left' };
  const route = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }], length: 300, status: 'routed' };
  for (const strength of [0, 100 / 3, 5000 / 96, 100, 200]) {
    const result = bezierDrawing(route, edge, strength, [], true), curves = cubics(result.path);
    for (const probe of [{ x: 37, y: 23 }, { x: 103, y: 27 }, { x: 171, y: 84 }, { x: -10, y: -20 }]) {
      const projected = result.locate(probe);
      const samples = curves.flatMap(curve => Array.from({ length: 2049 }, (_, i) => at(curve, i / 2048)));
      assert.ok(samples.some(sample => Math.hypot(sample.x - projected.x, sample.y - projected.y) < 0.2), 'A control must project onto its visible cubic.');
      const nearest = Math.min(...samples.map(sample => Math.hypot(sample.x - probe.x, sample.y - probe.y)));
      assert.ok(Math.hypot(projected.x - probe.x, projected.y - probe.y) <= nearest + 0.05, 'Projection must refine the nearest cached sample.');
    }
    for (const curve of curves) for (let i = 0; i <= 100; i++) {
      const point = at(curve, i / 100);
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= -64 && point.x <= 264 && point.y >= -64 && point.y <= 164);
    }
  }
});

Then('curved drawings open only the facing buffers of top and bottom ports', () => {
  for (const down of [true, false]) {
    const nodes = [{ id: 'source', x: -20, y: down ? 0 : 160, width: 40, height: 40 },
      { id: 'target', x: 60, y: down ? 160 : 0, width: 40, height: 40 }];
    const edge = { id: 'vertical', source: 'source', target: 'target', sourceX: 0, sourceY: down ? 40 : 160,
      targetX: 80, targetY: down ? 160 : 40, sourcePosition: down ? 'bottom' : 'top', targetPosition: down ? 'top' : 'bottom' };
    const route = routeEdges({ nodes, edges: [edge] }, { nodePadding: 16 }).get(edge.id);
    assert.equal(route.status, 'routed');
    const padded = nodes.map(node => ({ ...node, x: node.x - 16, y: node.y - 16, width: node.width + 32, height: node.height + 32 }));
    const result = bezierDrawing(route, edge, 100, padded);
    for (const curve of cubics(result.path)) for (let i = 0; i <= 100; i++) {
      const point = at(curve, i / 100);
      for (const node of nodes) assert.ok(!(point.x > node.x + 1e-6 && point.x < node.x + node.width - 1e-6 && point.y > node.y + 1e-6 && point.y < node.y + node.height - 1e-6), 'Only a facing port buffer may be crossed.');
    }
  }
});

const crowdedDrawing = (points, strength = 100) => bezierDrawing({ points, length: 0, status: 'routed' },
  { sourceX: points[0].x, sourceY: points[0].y, targetX: points.at(-1).x, targetY: points.at(-1).y, sourcePosition: 'right', targetPosition: 'left' }, strength,
  Array.from({ length: 8193 }, (_, i) => ({ id: `far-${i}`, x: 10_000 + i, y: 10_000, width: 1, height: 1 })));

Then('curved drawings fall back to their checked route when obstacle certification is exhausted', () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
  const before = structuredClone(points), result = crowdedDrawing(points);
  for (const curve of cubics(result.path)) {
    assert.deepEqual(curve[0], curve[1]); assert.deepEqual(curve[2], curve[3]);
    for (let i = 0; i <= 10; i++) {
      const point = at(curve, i / 10);
      assert.ok(Math.abs(point.y) < 1e-7 && point.x >= -1e-7 && point.x <= 100 + 1e-7 || Math.abs(point.x - 100) < 1e-7 && point.y >= -1e-7 && point.y <= 100 + 1e-7 || Math.abs(point.y - 100) < 1e-7 && point.x >= 100 - 1e-7 && point.x <= 200 + 1e-7,
        'Budget exhaustion must retain the already checked backbone.');
    }
  }
  assert.deepEqual(points, before);
});

Then('coincident curved connections retain finite paths labels and controls', () => {
  const point = { x: 0, y: 0 }, points = [point, { ...point }];
  for (const crowded of [false, true]) {
    const result = crowded ? crowdedDrawing(points) : bezierDrawing({ points, length: 0, status: 'routed' },
      { sourceX: 0, sourceY: 0, targetX: 0, targetY: 0, sourcePosition: 'right', targetPosition: 'left' }, 0, []);
    assert.deepEqual(result.midpoint, point);
    assert.deepEqual(result.locate({ x: 1, y: 1 }), point);
    assert.ok(cubics(result.path).flat().every(value => Number.isFinite(value.x) && Number.isFinite(value.y)));
  }
});

Then('Filleted Bezier and Clutter drawings differ while retaining finite endpoints and labels', () => {
  const edge = { sourceX: 0, sourceY: 0, sourcePosition: 'right', targetX: 200, targetY: 100, targetPosition: 'left' };
  const route = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }] };
  const paths = ['filleted', 'bezier', 'clutter'].map(style => bezierDrawing(route, edge, 100, [], true, style).path);
  assert.equal(new Set(paths).size, 3, 'Authored detours distinguish every smooth fitting style.');
  for (const style of ['filleted', 'bezier', 'clutter']) {
    for (const authored of [false, true]) {
      const drawing = bezierDrawing(route, edge, 100, [], authored, style);
      const curves = cubics(drawing.path);
      assert.deepEqual(curves[0][0], route.points[0]);
      assert.deepEqual(curves.at(-1).at(-1), route.points.at(-1));
      assert.ok(Number.isFinite(drawing.midpoint.x) && Number.isFinite(drawing.locate(drawing.midpoint).y));
    }
  }
  const point = { x: 0, y: 0 };
  const zero = bezierDrawing({ points: [point, point] }, { ...edge, targetX: 0, targetY: 0 }, 100,
    [{ id: 'cover', x: -1, y: -1, width: 2, height: 2 }], true, 'clutter');
  assert.ok(cubics(zero.path).flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});
