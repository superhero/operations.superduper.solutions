// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { workflowCurve, workflowCurveRadius } from './lib/workflow-curve.ts';
import { routeEdges } from './lib/flow-routing/router.js';
import { routePath, routeMidpoint } from './lib/flow-routing/path.js';
import { roundedSegments } from './lib/flow-routing/rounding.js';

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
    const segments = roundedSegments(route, workflowCurveRadius(strength), nodes.map(node => ({ ...node, x: node.x - 16, y: node.y - 16, width: node.width + 32, height: node.height + 32 })));
    assert.deepEqual(segments[0].from, { x: link.sourceX, y: link.sourceY });
    assert.deepEqual(segments.at(-1).to, { x: link.targetX, y: link.targetY });
    for (const segment of segments) for (let fraction = 0; fraction <= 1; fraction += 0.05) {
      const angle = segment.center && Math.atan2(segment.from.y - segment.center.y, segment.from.x - segment.center.x) + (segment.sweep ? 1 : -1) * fraction * Math.PI / 2;
      const point = segment.center ? { x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) }
        : { x: segment.from.x + (segment.to.x - segment.from.x) * fraction, y: segment.from.y + (segment.to.y - segment.from.y) * fraction };
      for (const node of nodes) assert.ok(!(point.x > node.x + 1e-6 && point.x < node.x + node.width - 1e-6 && point.y > node.y + 1e-6 && point.y < node.y + node.height - 1e-6), `${link.id} at strength ${strength} must not cross ${node.id}.`);
    }
  }
  assert.deepEqual([...routes], before, 'Drawing must not rewrite derived or authored anchors.');
});

Then('routed curve strength scales safe bends while preserving the same anchors', () => {
  const route = { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 400, y: 200 }], length: 600 };
  const snapshot = structuredClone(route);
  const weak = roundedSegments(route, workflowCurveRadius(50)), strong = roundedSegments(route, workflowCurveRadius(200));
  assert.equal(strong.find(segment => segment.radius).radius / weak.find(segment => segment.radius).radius, 4);
  assert.doesNotMatch(routePath(route, workflowCurveRadius(0)), / A/);
  for (const strength of [50, 200]) {
    assert.match(routePath(route, workflowCurveRadius(strength)), /^M 0 0 .*L 400 200$/);
    const middle = routeMidpoint(route, workflowCurveRadius(strength));
    assert.ok(Math.hypot(middle.x - 200, middle.y - 100) < 1e-9);
  }
  assert.deepEqual(route, snapshot);
});
