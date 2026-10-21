// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { workflowCurve } from './lib/workflow-curve.ts';
import { routeEdges } from './lib/flow-routing/router.js';
import { bezierDrawing } from './lib/flow-routing/bezier.ts';

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
  for (const strength of [0, 50, 100, 200]) for (const link of edges) {
    const route = routes.get(link.id);
    assert.equal(route.status, 'routed');
    const result = bezierDrawing(route, link, strength, nodes.map(node => ({ ...node, x: node.x - 16, y: node.y - 16, width: node.width + 32, height: node.height + 32 })));
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
