// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from 'node:assert/strict';
import { routingScenario } from './flow-routing-test-support.mjs';
import { releasedPreview } from './lib/flow-routing/handoff.js';
import { previewPath, routePath } from './lib/flow-routing/path.js';

function fixture() {
  const geometry = { id: '__connection-preview__', source: 'source', target: 'first',
    sourceX: 0, sourceY: 0, targetX: 300, targetY: 100, sourcePosition: 'right', targetPosition: 'left' };
  const route = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: -50 },
    { x: 280, y: -50 }, { x: 280, y: 100 }, { x: 300, y: 100 }], length: 500, status: 'routed' };
  const cache = { route, geometry, session: 7 };
  const lastPreview = { ...geometry, target: 'second', targetY: 200 };
  const edge = { ...lastPreview, id: 'committed' };
  return { cache, lastPreview, edge };
}

routingScenario(
  'an obstacle detour cached before the pointer changes its snap target',
  'the latest snapped preview is committed before a new route arrives',
  'the new edge receives the latest projected preview without changing its cached geometry',
  () => {
    const data = fixture();
    const snapshot = structuredClone(data);
    const output = releasedPreview(data.cache, data.lastPreview, 7, data.edge);
    return () => {
      assert.ok(output);
      assert.deepEqual(output.points, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: -50 },
        { x: 280, y: -50 }, { x: 280, y: 200 }, { x: 300, y: 200 }]);
      assert.equal(output.length, 600);
      assert.equal(routePath(output, 4), previewPath(data.cache.route, data.lastPreview, 4));
      assert.equal(output.status, 'routed');
      assert.notEqual(output, data.cache.route);
      assert.notEqual(output.points[0], data.cache.route.points[0]);
      assert.deepEqual(data, snapshot);
    };
  }
);

routingScenario(
  'a cached free-pointer detour in the current drag session',
  'the drag acquires a snap target and immediately commits',
  'the release inherits the displayed detour despite the cache having no target identity',
  () => {
    const { cache, lastPreview, edge } = fixture();
    delete cache.geometry.target;
    const snapshot = structuredClone(cache);
    const output = releasedPreview(cache, lastPreview, 7, edge);
    return () => {
      assert.ok(output);
      assert.equal(routePath(output, 4), previewPath(cache.route, lastPreview, 4));
      assert.deepEqual(output.points.at(-1), { x: 300, y: 200 });
      assert.deepEqual(cache, snapshot);
    };
  }
);

routingScenario(
  'a cached preview dragged from an input toward an output',
  'the reverse drag commits its latest snapped endpoints',
  'the completed route reverses the displayed preview and preserves port directions',
  () => {
    const { cache } = fixture();
    cache.route.points.reverse();
    cache.geometry = { ...cache.geometry, source: 'input', target: 'old-output',
      sourceX: 300, sourceY: 100, targetX: 0, targetY: 0, sourcePosition: 'left', targetPosition: 'right' };
    const lastPreview = { ...cache.geometry, target: 'output', targetY: 200 };
    const edge = { id: 'committed', source: 'output', target: 'input',
      sourceX: 0, sourceY: 200, targetX: 300, targetY: 100, sourcePosition: 'right', targetPosition: 'left' };
    const snapshot = structuredClone({ cache, lastPreview, edge });
    const output = releasedPreview(cache, lastPreview, 7, edge);
    return () => {
      assert.ok(output);
      assert.deepEqual(output.points, [{ x: 0, y: 200 }, { x: 20, y: 200 }, { x: 20, y: -50 },
        { x: 280, y: -50 }, { x: 280, y: 100 }, { x: 300, y: 100 }]);
      assert.equal(output.length, 700);
      assert.equal(output.status, 'routed');
      assert.equal(routePath({ ...output, points: [...output.points].reverse() }, 4), previewPath(cache.route, lastPreview, 4));
      assert.notEqual(output.points.at(-1), cache.route.points[0]);
      assert.deepEqual({ cache, lastPreview, edge }, snapshot);
    };
  }
);

routingScenario(
  'a valid cached preview and its latest snapped geometry',
  'stale unrelated and incompatible connections request the cached release',
  'only the matching drag and exact committed endpoint identities are eligible',
  () => {
    const { cache, lastPreview, edge } = fixture();
    const rejected = [
      ['no cache', null, lastPreview, 7, edge],
      ['no active preview', cache, null, 7, edge],
      ['another drag', cache, lastPreview, 8, edge],
      ['another source', cache, { ...lastPreview, source: 'other' }, 7, edge],
      ['moved source', cache, { ...lastPreview, sourceX: 1 }, 7, { ...edge, sourceX: 1 }],
      ['different source direction', cache, { ...lastPreview, sourcePosition: 'bottom' }, 7, edge],
      ['different target direction', cache, { ...lastPreview, targetPosition: 'top' }, 7, edge],
      ['unsnapped preview', cache, { ...lastPreview, target: undefined }, 7, { ...edge, target: undefined }],
      ['unrelated edge source', cache, lastPreview, 7, { ...edge, source: 'other' }],
      ['unrelated edge target', cache, lastPreview, 7, { ...edge, target: 'other' }],
      ['incomplete reverse identity', cache, lastPreview, 7, { ...edge, source: 'other', target: lastPreview.source }],
      ...['sourceX', 'sourceY', 'targetX', 'targetY'].map(key =>
        [`changed committed ${key}`, cache, lastPreview, 7, { ...edge, [key]: edge[key] + 1 }]),
      ...['sourcePosition', 'targetPosition'].map(key =>
        [`changed committed ${key}`, cache, lastPreview, 7, { ...edge, [key]: 'top' }]),
    ].map(([name, cache, preview, session, edge]) => ({ name, result: releasedPreview(cache, preview, session, edge) }));
    return () => {
      for (const { name, result } of rejected) assert.equal(result, null, name);
      assert.ok(releasedPreview(cache, lastPreview, 7, edge));
    };
  }
);

routingScenario(
  'invalid and unprojectable cached route geometries',
  'their matching preview endpoints are committed',
  'the release declines each invalid projection without mutating the cache',
  () => {
    const { cache, lastPreview, edge } = fixture();
    const invalid = [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: Infinity, y: 0 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 300, y: 100 }],
    ].map(points => ({ ...cache, route: { ...cache.route, points } }));
    const snapshot = structuredClone(invalid);
    const results = invalid.map(candidate => releasedPreview(candidate, lastPreview, 7, edge));
    return () => {
      assert.deepEqual(results, invalid.map(() => null));
      assert.deepEqual(invalid, snapshot);
    };
  }
);
