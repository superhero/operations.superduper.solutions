// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Cases ported individually from laya-ai/test/unit/flow-routing-path.test.js.
import { routingScenario } from './flow-routing-test-support.mjs';
import assert from 'node:assert/strict';
import { cachedPreview, previewPath, projectRoute, routeMidpoint, routePath } from './lib/flow-routing/path.js';
import { routeConnection } from './lib/flow-routing/router.js';

const route = { points: [{ x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 200 }, { x: 300, y: 200 }], length: 500, status: 'routed' };
const edge = (values = {}) => ({ sourceX: 0, sourceY: 0, targetX: 300, targetY: 200,
  sourcePosition: 'right', targetPosition: 'left', ...values });

routingScenario(
  "a right-angle route with an eight-unit corner radius",
  "its rendered path preview and midpoint are calculated",
  "rounded paths, drag previews, and label midpoints use the same 8px corner",
  () => {
    const corner = { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], length: 80 };
    const expected = 'M 0 0 L 32 0 A 8 8 0 0 1 40 8 L 40 40';
    const actual = routePath(corner, 8);
    return () => {
      assert.equal(actual, expected);
      assert.equal(previewPath(corner, edge({ targetX: 40, targetY: 40, targetPosition: 'top' }), 8), expected);
      const midpoint = routeMidpoint(corner, 8);
      assert.ok(Math.abs(midpoint.x - (32 + Math.sqrt(32))) < 1e-9);
      assert.ok(Math.abs(midpoint.y - (8 - Math.sqrt(32))) < 1e-9);
      const obstacles = [{ x: 35, y: 2, width: 2, height: 2 }];
      assert.equal(routePath(corner, 8, obstacles), routePath(corner));
      assert.deepEqual(routeMidpoint(corner, 8, obstacles), { x: 40, y: 0 });
    };
  }
);

routingScenario(
  "a horizontal terminal route and a nearby moving pointer",
  "the pending horizontal preview follows the pointer",
  "a pending horizontal preview keeps its prefix while following the exact moving tip",
  () => {
    const snapshot = structuredClone(route);
    const actual = previewPath(route, edge({ targetX: 303, targetY: 202 }));
    return () => {
      assert.equal(actual, 'M 0 0 L 280 0 L 280 202 L 303 202');
      assert.deepEqual(route, snapshot);
    };
  }
);

routingScenario(
  "a vertical terminal route and a nearby moving pointer",
  "the pending vertical preview follows the pointer",
  "vertical terminal previews project the last bend in the perpendicular direction",
  () => {
    const vertical = { ...route, points: route.points.map(({ x, y }) => ({ x: y, y: x })) };
    const actual = previewPath(vertical, edge({ targetX: 202, targetY: 303, sourcePosition: 'bottom', targetPosition: 'top' }));
    return () => {
      assert.equal(actual,
        'M 0 0 L 0 280 L 202 280 L 202 303');
    };
  }
);

routingScenario(
  "a cached route with exact missing and stale source geometries",
  "each source geometry is considered for a preview",
  "exact previews retain their route and missing or stale source geometry is rejected",
  () => {
    const actual = previewPath(route, edge());
    return () => {
      assert.equal(actual, routePath(route));
      assert.equal(previewPath(null, edge()), null);
      assert.equal(previewPath({ points: [] }, edge()), null);
      assert.equal(previewPath(route, null), null);
      assert.equal(previewPath(route, edge({ sourceX: 5, targetX: 303 })), null);
      assert.equal(previewPath(route, edge({ targetX: NaN })), null);
    };
  }
);

routingScenario(
  "routes with reversed diagonal and changed-direction approaches",
  "invalid terminal projections are compared with a valid perpendicular change",
  "projection rejects reversed approaches, turns, or changed port directions",
  () => {
    const actual = previewPath(route, edge({ targetX: -5 }));
    return () => {
      assert.equal(actual, null, 'moving the approach cannot reverse the source direction');
      assert.equal(previewPath(route, edge({ targetY: -1 })), 'M 0 0 L 280 0 L 280 -1 L 300 -1', 'an interior perpendicular leg can change direction');
      assert.equal(previewPath(route, edge({ targetX: 303, targetPosition: 'top' })), null);
      assert.equal(previewPath(route, edge({ targetX: 303, sourcePosition: 'bottom' })), null);
      const reversed = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 200 }, { x: 300, y: 200 }] };
      assert.equal(previewPath(reversed, edge({ targetX: 303 })), null);
      const diagonal = { points: [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 100, y: 200 }, { x: 300, y: 200 }] };
      assert.equal(previewPath(diagonal, edge({ targetX: 303 })), null);
      const short = { points: [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }] };
      assert.equal(previewPath(short, edge({ targetX: -5, sourcePosition: 'bottom' })), null, 'moving the approach cannot move the source');
      const staircase = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 },
        { x: 200, y: 50 }, { x: 200, y: 100 }, { x: 220, y: 100 }] };
      assert.equal(previewPath(staircase, edge({ targetX: 90, targetY: 101 })), null, 'an interior prefix segment cannot reverse either');
    };
  }
);

routingScenario(
  "an outer detour and a snapped input on the reversed side",
  "the final approach moves across the source while retaining the detour",
  "a reversed-side snap moves the final approach while retaining the outer detour",
  () => {
    const detour = { points: [{ x: 865, y: 483 }, { x: 885, y: 483 }, { x: 885, y: 216 },
      { x: 315, y: 216 }, { x: 315, y: 180 }, { x: 335, y: 180 }] };
    const geometry = edge({ sourceX: 865, sourceY: 483, targetX: -5, targetY: 71.5 });
    const snapshot = structuredClone(detour);
    const actual = previewPath(detour, geometry);
    return () => {
      assert.equal(actual, 'M 865 483 L 885 483 L 885 216 L -25 216 L -25 71.5 L -5 71.5');
      const vertical = { points: detour.points.map(({ x, y }) => ({ x: y, y: x })) };
      assert.equal(previewPath(vertical, edge({ sourceX: 483, sourceY: 865, targetX: 71.5, targetY: -5,
        sourcePosition: 'bottom', targetPosition: 'top' })),
      'M 483 865 L 483 885 L 216 885 L 216 -25 L 71.5 -25 L 71.5 -5');
      assert.deepEqual(detour, snapshot);
      assert.equal(previewPath(detour, { ...geometry, targetX: 335, targetY: 180 }), routePath(detour), 'the other preview stays independent');
    };
  }
);

routingScenario(
  "a short two-bend preview and a target near its final bend",
  "the terminal approach moves toward the source",
  "a short detour can move its approach without reversing the prefix or collapsing its terminal segment",
  () => {
    const actual = previewPath(route, edge({ targetX: 270 }));
    return () => {
      assert.equal(actual, 'M 0 0 L 250 0 L 250 200 L 270 200');
      assert.equal(previewPath(route, edge({ targetX: 280 })), 'M 0 0 L 260 0 L 260 200 L 280 200');
    };
  }
);

routingScenario(
  "routes with duplicate vertices and a straight source segment",
  "the target moves while preview direction checks are applied",
  "zero-length segments do not change direction checks and straight routes keep their source fixed",
  () => {
    const duplicates = { points: [route.points[0], route.points[0], route.points[1], route.points[2], route.points[2], route.points[3], route.points[3]] };
    const actual = previewPath(duplicates, edge({ targetX: 303, targetY: 202 }));
    return () => {
      assert.equal(actual, 'M 0 0 L 280 0 L 280 202 L 303 202');
      const straight = { points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] };
      assert.equal(previewPath(straight, edge({ targetX: 303, targetY: 0 })), 'M 0 0 L 303 0');
      assert.ok(previewPath(straight, edge({ targetX: 303, targetY: 2 })));
      assert.ok(previewPath(straight, edge({ targetX: -1, targetY: 0 })));
    };
  }
);

function assertGeometry(projected, geometry) {
  assert.ok(projected, 'endpoint projection must not fall back');
  assert.deepEqual(projected.points[0], { x: geometry.sourceX, y: geometry.sourceY });
  assert.deepEqual(projected.points.at(-1), { x: geometry.targetX, y: geometry.targetY });
  const turns = projected.points.slice(1).map((point, index) => {
    const previous = projected.points[index];
    assert.ok((point.x === previous.x) !== (point.y === previous.y), 'each nonempty segment is orthogonal');
    return point.y === previous.y ? (point.x > previous.x ? 0 : 2) : (point.y > previous.y ? 1 : 3);
  });
  const sides = { right: 0, bottom: 1, left: 2, top: 3 };
  assert.equal(turns[0], sides[geometry.sourcePosition]);
  assert.equal(turns.at(-1), (sides[geometry.targetPosition] + 2) % 4);
  assert.ok(turns.every((turn, index) => !index || turn !== (turns[index - 1] + 2) % 4), 'no segment reverses at a bend');
  assert.equal(projected.length, projected.points.slice(1).reduce((sum, point, index) => sum +
    Math.abs(point.x - projected.points[index].x) + Math.abs(point.y - projected.points[index].y), 0));
}

routingScenario(
  "a hairpin detour next to its collapsing bend axis",
  "the target crosses the axis in both orientations",
  "crossing the bend axis keeps the detour before, at, and after a collapsed hairpin",
  () => {
    const detour = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 },
      { x: -120, y: 100 }, { x: -120, y: 80 }, { x: -100, y: 80 }] };
    const snapshot = structuredClone(detour);
    return () => {
      for (const vertical of [false, true]) {
        const original = vertical ? { points: detour.points.map(({ x, y }) => ({ x: y, y: x })) } : detour;
        for (const across of [99.9, 100, 100.1]) {
          const geometry = edge(vertical ? { targetX: across, targetY: -100, sourcePosition: 'bottom', targetPosition: 'top' } :
            { targetX: -100, targetY: across });
          const projected = projectRoute(original, geometry);
          assertGeometry(projected, geometry);
          assert.deepEqual(projected.points.slice(0, 2), original.points.slice(0, 2));
          assert.ok(Math.abs(projected.length - 280) <= 2.1, 'axis repair must remain local rather than creating a large transient detour');
          assert.equal(previewPath(original, geometry), routePath(projected));
        }
      }
      assert.deepEqual(detour, snapshot);
    };
  }
);

routingScenario(
  "an attached detour with independently movable endpoints",
  "source target equal and unequal endpoint movements are projected",
  "attached endpoint movement keeps the interior fixed and equal movement translates the whole route",
  () => {
    const detour = { points: [{ x: 865, y: 483 }, { x: 885, y: 483 }, { x: 885, y: 216 },
      { x: 315, y: 216 }, { x: 315, y: 180 }, { x: 335, y: 180 }], status: 'routed' };
    const geometry = edge({ sourceX: 865, sourceY: 483, targetX: 335, targetY: 180 });
    const snapshot = structuredClone(detour);
    const source = { ...geometry, sourceX: 870, sourceY: 490 };
    const movedSource = projectRoute(detour, source);
    return () => {
      assertGeometry(movedSource, source);
      assert.deepEqual(movedSource.points.slice(2), detour.points.slice(2));
      assert.equal(previewPath(detour, source), null, 'a drag preview still cannot borrow another source endpoint');
      const target = { ...geometry, targetX: 340, targetY: 183 };
      const movedTarget = projectRoute(detour, target);
      assertGeometry(movedTarget, target);
      assert.deepEqual(movedTarget.points.slice(0, -2), detour.points.slice(0, -2));
      const both = { ...geometry, sourceX: 875, sourceY: 478, targetX: 345, targetY: 175 };
      const movedBoth = projectRoute(detour, both);
      assertGeometry(movedBoth, both);
      assert.deepEqual(movedBoth.points, detour.points.map(({ x, y }) => ({ x: x + 10, y: y - 5 })));
      const unequal = { ...source, targetX: target.targetX, targetY: target.targetY };
      assertGeometry(projectRoute(detour, unequal), unequal);
      assert.deepEqual(detour, snapshot);
      const short = projectRoute(route, edge({ targetX: 303, targetY: 202 }));
      assert.equal(short.length, 505);
      assert.deepEqual(routeMidpoint(short), { x: 252.5, y: 0 });
    };
  }
);

routingScenario(
  "initially straight routes in both orientations",
  "either endpoint moves away from its original line",
  "initially straight arrows acquire local elbows for source or target movement in both orientations",
  () => {
    return () => {
      for (const vertical of [false, true]) {
        const original = { points: [{ x: 0, y: 0 }, vertical ? { x: 0, y: 300 } : { x: 300, y: 0 }] };
        const geometry = edge(vertical ? { targetX: 0, targetY: 300, sourcePosition: 'bottom', targetPosition: 'top' } : { targetY: 0 });
        for (const [endpoint, x, y] of [['source', 5, 7], ['target', 303, 2], ['target', -1, -1]]) {
          const current = { ...geometry, [`${endpoint}X`]: vertical ? y : x, [`${endpoint}Y`]: vertical ? x : y };
          assertGeometry(projectRoute(original, current), current);
        }
      }
    };
  }
);

routingScenario(
  "a shared cached route for a pointer and a landing ghost",
  "the pointer moves while the landing ghost stays snapped",
  "pointer and snap-ghost projections remain independent",
  () => {
    const snapshot = structuredClone(route);
    const ghost = previewPath(route, edge());
    const pointer = previewPath(route, edge({ targetX: 305, targetY: 204 }));
    return () => {
      assert.equal(ghost, 'M 0 0 L 280 0 L 280 200 L 300 200');
      assert.equal(pointer, 'M 0 0 L 280 0 L 280 204 L 305 204');
      assert.equal(previewPath(route, edge()), ghost);
      assert.deepEqual(route, snapshot);
    };
  }
);

routingScenario(
  "a scoped preview cache containing an obstacle detour",
  "the drag acquires changes and loses its snap target",
  "the scope cache retains its obstacle detour when acquiring, changing, and losing a snap target",
  () => {
    const geometry = edge({ source: 'source', target: undefined, targetY: 0 });
    const obstacle = { id: 'blocker', x: 100, y: -30, width: 100, height: 60 };
    const routed = routeConnection(geometry, [obstacle]);
    return () => {
      assert.equal(routed.status, 'routed');
      assert.ok(routed.points.some(point => Math.abs(point.y) >= 42));
      const cache = { route: routed, geometry, session: 7 };
      const snapshot = structuredClone(cache);
      const prefix = routePath({ points: routed.points.slice(0, -2) });
      for (const [target, targetX, targetY] of [[undefined, 303, 1], ['A', 304, 2], ['B', 305, 3], [undefined, 306, 4]]) {
        const current = { ...geometry, target, targetX, targetY };
        const selected = cachedPreview(cache, current, 7);
        assert.equal(selected, routed, 'target identity must not discard the current drag detour');
        const path = previewPath(selected, current);
        assert.ok(path.startsWith(prefix), 'the existing obstacle detour stays visible');
        assert.ok(path.endsWith(`L ${targetX} ${targetY}`), 'the tip follows the exact current endpoint');
      }
      assert.deepEqual(cache, snapshot);
    };
  }
);

routingScenario(
  "a scoped preview cache tied to one drag and source direction",
  "inactive and unrelated geometries attempt to reuse that cache",
  "the scope cache rejects inactive geometry, other drag sessions, sources, or directions",
  () => {
    const geometry = edge({ source: 'source', target: 'A' });
    const cache = { route, geometry, session: 7 };
    const actual = cachedPreview(null, geometry, 7);
    return () => {
      assert.equal(actual, null);
      assert.equal(cachedPreview({ ...cache, geometry: null }, geometry, 7), null);
      assert.equal(cachedPreview(cache, null, 7), null);
      assert.equal(cachedPreview(cache, geometry, 8), null);
      for (const change of [{ source: 'another' }, { sourceX: 1 }, { sourceY: 1 }, { sourcePosition: 'bottom' }, { targetPosition: 'top' }]) {
        assert.equal(cachedPreview(cache, { ...geometry, ...change }, 7), null);
      }
      assert.equal(cachedPreview(cache, { ...geometry, target: undefined }, 7), route);
    };
  }
);
