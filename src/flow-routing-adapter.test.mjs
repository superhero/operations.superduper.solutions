// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Cases ported individually from laya-ai/test/unit/flow-routing-adapter.test.js.
import { routingScenario } from './flow-routing-test-support.mjs';
import assert from 'node:assert/strict';
import { createRoutingSession } from './lib/flow-routing/session.js';
import { routingScene, connectionGeometry, pointerGeometry } from './lib/flow-routing/geometry.js';
import { routeEdges, routeConnection } from './lib/flow-routing/router.js';

const handle = (id, position, x, y) => ({ id, position, x, y, width: 10, height: 10 });
const internal = (id, x, y, source = [], target = []) => ({
  id, position: { x: 1, y: 2 }, width: 999, height: 999,
  measured: { width: 120, height: 80 },
  internals: { positionAbsolute: { x, y }, handleBounds: { source, target } },
});

routingScenario(
  "measured source and target nodes whose handles have no identifiers",
  "a snapped unnamed-handle preview is compared with a completed edge",
  "unnamed handles resolve their outer positions and absent pointers retain the snapped endpoint",
  () => {
    const source = internal('source', 10, 20, [handle(undefined, 'right', 115, 35)]);
    const target = internal('target', 400, 100, [], [handle(undefined, 'left', -5, 35)]);
    const nodes = [source, target];
    const connection = { inProgress: true, isValid: true, fromNode: source, toNode: target,
      fromHandle: { type: 'source' }, toHandle: { type: 'target' },
      from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, fromPosition: 'right', toPosition: 'left' };
    const snapshot = structuredClone(connection);
    const scene = routingScene(nodes, [{ id: 'completed', source: 'source', target: 'target' }],
      id => nodes.find(node => node.id === id));
    const preview = connectionGeometry(connection);
    const pointerFree = pointerGeometry(connection, { x: -50, y: 30, zoom: 2 });
    const missing = connectionGeometry({ ...connection,
      fromHandle: { type: 'source', id: 'removed' }, toHandle: { type: 'target', id: 'removed' } });
    return () => {
      assert.deepEqual(preview, { ...scene.edges[0], id: '__connection-preview__' });
      assert.deepEqual([preview.sourceX, preview.sourceY, preview.targetX, preview.targetY], [135, 60, 395, 140]);
      assert.deepEqual(pointerFree, preview);
      assert.deepEqual([missing.sourceX, missing.sourceY, missing.targetX, missing.targetY], [1, 2, 3, 4]);
      assert.deepEqual(connection, snapshot);
    };
  }
);

routingScenario(
  "measured absolute node bounds and several named handles",
  "the routing scene is built from the named connection handles",
  "routing uses measured node bounds and the named handles in absolute flow coordinates",
  () => {
    const source = internal('source', 300.5, 100.25,
      [handle('other', 'bottom', 55, 75), handle('field', 'right', 115, 20)]);
    const target = internal('target', 700.5, 400.25, [],
      [handle('other', 'top', 55, -5), handle('gate', 'left', -5, 50)]);
    const lookup = new Map([['source', source], ['target', target]]);
    const nodes = [{ id: 'source', parentId: 'group', origin: [0.5, 0.5] }, { id: 'target' }];
    const edges = [{ id: 'mapping', source: 'source', target: 'target', sourceHandle: 'field', targetHandle: 'gate' }];
    const before = structuredClone({ source, target, nodes, edges });
    const actual = routingScene(nodes, edges, id => lookup.get(id));
    return () => {
      assert.deepEqual(actual, {
        nodes: [
          { id: 'source', x: 300.5, y: 100.25, width: 120, height: 80 },
          { id: 'target', x: 700.5, y: 400.25, width: 120, height: 80 },
        ],
        edges: [{ id: 'mapping', source: 'source', target: 'target',
          sourceX: 425.5, sourceY: 125.25, sourcePosition: 'right',
          targetX: 695.5, targetY: 455.25, targetPosition: 'left' }],
      });
      assert.deepEqual({ source, target, nodes, edges }, before);
    };
  }
);

routingScenario(
  "visible nodes mixed with hidden unmeasured and non-routed items",
  "the routing scene filters unsupported nodes and edges",
  "hidden branches, missing measurements and non-routed edge styles stay out of the routing scene",
  () => {
    const source = internal('source', 0, 0, [handle('out', 'bottom', 55, 75)]);
    const target = internal('target', 0, 200, [], [handle('in', 'top', 55, -5)]);
    const hidden = { ...internal('hidden', 0, 100, [], [handle('in', 'top', 55, -5)]), hidden: true };
    const group = { ...internal('group', -100, -100), type: 'group' };
    const unmeasured = { id: 'unmeasured', measured: {}, internals: { positionAbsolute: { x: 0, y: 0 } } };
    const nodes = [source, target, hidden, group, unmeasured, { id: 'missing' }];
    const lookup = new Map(nodes.filter(node => node.id !== 'missing').map(node => [node.id, node]));
    const edge = { source: 'source', target: 'target', sourceHandle: 'out', targetHandle: 'in' };
    const edges = [
      { ...edge, id: 'visible', type: 'smoothstep' },
      { ...edge, id: 'hidden-edge', hidden: true },
      { ...edge, id: 'detached', detached: true },
      { ...edge, id: 'curved', type: 'default' },
      { ...edge, id: 'custom', type: 'custom' },
      { ...edge, id: 'hidden-target', target: 'hidden' },
      { ...edge, id: 'not-ready', target: 'unmeasured' },
      { ...edge, id: 'deleted', target: 'missing' },
      { ...edge, id: 'removed-handle', targetHandle: 'removed' },
      { ...edge, id: 'wrong-handle-type', target: 'source', targetHandle: 'out' },
    ];
    const scene = routingScene(nodes, edges, id => lookup.get(id));
    return () => {
      assert.deepEqual(scene.nodes.map(node => node.id), ['source', 'target']);
      assert.deepEqual(scene.edges.map(edge => edge.id), ['visible', 'curved']);
      assert.equal(scene.edges[0].sourcePosition, 'bottom');
      assert.equal(scene.edges[0].targetPosition, 'top');
    };
  }
);

routingScenario(
  "an active connection with fractional pointer coordinates",
  "free and snapped connection geometries are derived",
  "connection previews retain exact pointer geometry and handle direction before and after snapping",
  () => {
    const actual = connectionGeometry({ inProgress: false });
    return () => {
      assert.equal(actual, null);
      const connection = { inProgress: true, fromNode: { id: 'source' }, toNode: null,
        from: { x: 10.5, y: 20.25 }, to: { x: 80.5, y: 150.25 },
        fromPosition: 'top', toPosition: 'bottom' };
      const free = connectionGeometry(connection);
      assert.equal(free.source, 'source');
      assert.equal(free.target, undefined);
      assert.deepEqual([free.sourceX, free.sourceY, free.targetX, free.targetY], [10.5, 20.25, 80.5, 150.25]);
      assert.deepEqual([free.sourcePosition, free.targetPosition], ['top', 'bottom']);
      const snapped = connectionGeometry({ ...connection, isValid: true, toNode: { id: 'target' },
        to: { x: 200, y: 300 }, toPosition: 'left' });
      assert.deepEqual([snapped.target, snapped.targetX, snapped.targetY, snapped.targetPosition], ['target', 200, 300, 'left']);
    };
  }
);

routingScenario(
  "a snapped connection with a separate raw screen pointer",
  "pointer and landing geometries are calculated at two zoom levels",
  "the cursor arrow follows the raw pointer while the landing preview remains snapped",
  () => {
    const connection = { inProgress: true, isValid: true, fromNode: { id: 'source' }, toNode: { id: 'target' },
      from: { x: 20, y: 30 }, to: { x: 200, y: 300 }, pointer: { x: 230, y: 260 },
      fromPosition: 'right', toPosition: 'top' };
    const before = structuredClone(connection);
    return () => {
      for (const viewport of [{ x: 30, y: 60, zoom: 0.5 }, { x: -100, y: 20, zoom: 2 }]) {
        const pointer = pointerGeometry(connection, viewport);
        assert.deepEqual([pointer.targetX, pointer.targetY],
          [(230 - viewport.x) / viewport.zoom, (260 - viewport.y) / viewport.zoom]);
        assert.equal(pointer.target, undefined);
        assert.equal(pointer.targetPosition, 'left');
        const snapped = connectionGeometry(connection);
        assert.deepEqual([snapped.target, snapped.targetX, snapped.targetY], ['target', 200, 300]);
      }
      assert.deepEqual(connection, before);
      assert.equal(pointerGeometry({ inProgress: false }, { x: 0, y: 0, zoom: 1 }), null);
    };
  }
);

routingScenario(
  "a completed edge and a matching snapped drag in each direction",
  "the preview endpoints are compared with the completed edge",
  "snapped previews use the same outer handle endpoints as completed edges in either drag direction",
  () => {
    const source = internal('source', 300.5, 100.25, [handle('out', 'right', 115, 20)]);
    const target = internal('target', 700.5, 400.25, [], [handle('in', 'left', -5, 50)]);
    const lookup = new Map([source, target].map(node => [node.id, node]));
    const [finished] = routingScene([source, target], [{ id: 'edge', source: source.id, target: target.id,
      sourceHandle: 'out', targetHandle: 'in' }], id => lookup.get(id)).edges;
    const connection = { inProgress: true, isValid: true, fromNode: source, toNode: target,
      fromHandle: { ...source.internals.handleBounds.source[0], type: 'source' },
      toHandle: { ...target.internals.handleBounds.target[0], type: 'target', x: 700.5, y: 455.25 },
      from: { x: 420.5, y: 125.25 }, to: { x: 700.5, y: 455.25 },
      fromPosition: 'right', toPosition: 'left' };
    const actual = connectionGeometry(connection);
    return () => {
      assert.deepEqual(actual, { ...finished, id: '__connection-preview__' });
      const reverse = connectionGeometry({ ...connection, fromNode: target, toNode: source,
        fromHandle: { ...target.internals.handleBounds.target[0], type: 'target' },
        toHandle: { ...source.internals.handleBounds.source[0], type: 'source', ...connection.from },
        from: connection.to, to: connection.from, fromPosition: 'left', toPosition: 'right' });
      assert.deepEqual([reverse.sourceX, reverse.sourceY, reverse.targetX, reverse.targetY],
        [finished.targetX, finished.targetY, finished.sourceX, finished.sourceY]);
      const invalid = connectionGeometry({ ...connection, isValid: false, to: { x: 690, y: 450 } });
      assert.equal(invalid.target, undefined, 'an invalid hovered handle is still a free pointer');
      assert.deepEqual([invalid.targetX, invalid.targetY], [690, 450]);
    };
  }
);

routingScenario(
  "an existing arrow and a preview sharing one source handle",
  "the measured preview is routed beside the existing arrow",
  "a preview sharing an existing source handle avoids a false crossing detour",
  () => {
    const source = internal('source', 0, 0, [handle('out', 'right', 115, 35)]);
    const existing = internal('existing', 250, -200, [], [handle('in', 'left', -5, 35)]);
    const target = internal('target', 400, -100, [], [handle('in', 'left', -5, 35)]);
    const nodes = [source, existing, target], lookup = new Map(nodes.map(node => [node.id, node]));
    const scene = routingScene(nodes, [{ id: 'existing-edge', source: source.id, target: existing.id,
      sourceHandle: 'out', targetHandle: 'in' }], id => lookup.get(id));
    const routes = routeEdges(scene);
    const preview = connectionGeometry({ inProgress: true, isValid: true, fromNode: source, toNode: target,
      fromHandle: { ...source.internals.handleBounds.source[0], type: 'source' },
      toHandle: { ...target.internals.handleBounds.target[0], type: 'target', x: 400, y: -60 },
      from: { x: 120, y: 40 }, to: { x: 400, y: -60 }, fromPosition: 'right', toPosition: 'left' });
    const route = routeConnection(preview, scene.nodes, scene.edges.map(edge => ({ ...edge, ...routes.get(edge.id) })));
    return () => {
      assert.equal(route.length, 370, 'shared-port routing keeps the shortest path instead of the former 420px detour');
      assert.deepEqual(route.points, [{ x: 125, y: 40 }, { x: 225, y: 40 }, { x: 225, y: -60 }, { x: 395, y: -60 }]);
    };
  }
);

// The browser worker delegates to this pure session; injection makes reuse observable.
function routingWorker() {
  let sceneCalculations = 0;
  const session = createRoutingSession({ routeConnection,
    routeEdges(...args) { sceneCalculations++; return routeEdges(...args); }
  });
  return {
    send(data) { return session.calculate(structuredClone(data)); },
    get sceneCalculations() { return sceneCalculations; }
  };
}

routingScenario(
  "routing sessions whose full and incremental engines can fail",
  "a scene edit fails and the previous scene is requested before retrying",
  "the native error cause is preserved and only successful edits replace cached routes",
  () => {
    const existing = { id: 'existing', source: 'a', target: 'b', sourceX: 0, sourceY: 0,
      targetX: 300, targetY: 0, sourcePosition: 'right', targetPosition: 'left' };
    const initial = { nodes: [], edges: [existing] };
    const defaultResult = createRoutingSession().calculate({ sceneRevision: 1, scene: initial });
    const outcomes = ['layout', 'edge'].map(mode => {
      let fail = false, sceneCalculations = 0, connectionCalculations = 0;
      const cause = new DOMException('Search interrupted', 'AbortError');
      const failure = new Error(`Cannot calculate ${mode}`, { cause });
      const session = createRoutingSession({
        routeEdges(...args) {
          sceneCalculations++;
          if (fail && mode === 'layout') throw failure;
          return routeEdges(...args);
        },
        routeConnection(...args) {
          connectionCalculations++;
          if (fail && mode === 'edge') throw failure;
          return routeConnection(...args);
        },
      });
      const before = session.calculate({ sceneRevision: 1, scene: initial });
      const edit = mode === 'layout'
        ? { ...initial, nodes: [{ id: 'blocker', x: 100, y: -30, width: 100, height: 60 }] }
        : { ...initial, edges: [existing, { ...existing, id: 'added', sourceY: 80, targetY: 80 }] };
      fail = true;
      let caught;
      try { session.calculate({ sceneRevision: 2, scene: edit }); } catch (error) { caught = error; }
      const retained = session.calculate({ sceneRevision: 3, scene: initial });
      fail = false;
      const recovered = session.calculate({ sceneRevision: 4, scene: edit });
      const repeated = session.calculate({ sceneRevision: 5, scene: edit });
      return { mode, before, caught, failure, cause, retained, recovered, repeated, sceneCalculations, connectionCalculations };
    });
    return () => {
      assert.deepEqual(defaultResult.routes, routeEdges(initial));
      assert.equal(defaultResult.connection, null);
      for (const result of outcomes) {
        assert.equal(result.caught, result.failure);
        assert.equal(result.caught.cause, result.cause);
        assert.equal(result.retained.routes, result.before.routes, 'failed edits must not overwrite the cache');
        assert.equal(result.retained.sceneRevision, 3);
        assert.notEqual(result.recovered.routes, result.before.routes);
        assert.equal(result.repeated.routes, result.recovered.routes);
        assert.equal(result.repeated.sceneRevision, 5);
        assert.equal(result.sceneCalculations, result.mode === 'layout' ? 3 : 1);
        assert.equal(result.connectionCalculations, result.mode === 'edge' ? 2 : 0);
        if (result.mode === 'layout') assert.ok(result.recovered.routes.get('existing').length > 300);
        else assert.equal(result.recovered.routes.get('existing'), result.before.routes.get('existing'));
      }
    };
  }
);

routingScenario(
  "a routing session with an existing crossing arrow",
  "pointer movement and crossing options change between calculations",
  "worker reuses scene routing during pointer movement and applies changed crossing options",
  () => {
    const worker = routingWorker();
    const scene = { nodes: [], edges: [{ id: 'vertical', source: 'c', target: 'd',
      sourceX: 150, sourceY: -40, targetX: 150, targetY: 40, sourcePosition: 'bottom', targetPosition: 'top' }] };
    const preview = { id: 'preview', source: 'a', target: 'b', sourceX: 0, sourceY: 0,
      targetX: 300, targetY: 0, sourcePosition: 'right', targetPosition: 'left' };
    const first = worker.send({ sceneRevision: 7, scene, preview });
    return () => {
      assert.equal(first.sceneRevision, 7);
      assert.deepEqual([...first.routes.keys()], ['vertical']);
      assert.ok(first.connection.length > 300 && first.connection.length <= 1200);

      const moved = { ...preview, targetX: 320 };
      const second = worker.send({ sceneRevision: 7, scene, preview: moved });
      assert.deepEqual(second.preview, moved);
      assert.deepEqual(second.connection.points.at(-1), { x: 320, y: 0 });
      assert.equal(worker.sceneCalculations, 1, 'pointer movement must not reroute the existing graph');

      const restricted = worker.send({ sceneRevision: 8, scene, preview, options: { maxLengthRatio: 1 } });
      assert.equal(restricted.sceneRevision, 8);
      assert.equal(restricted.connection.length, 300, 'new options must replace the cached crossing policy');
      assert.equal(worker.sceneCalculations, 2);

      const removed = worker.send({ sceneRevision: 9, scene: { nodes: [], edges: [] }, preview });
      assert.equal(removed.routes.size, 0);
      assert.equal(removed.connection.length, 300, 'removed edges must stop obstructing previews');
      const stopped = worker.send({ sceneRevision: 9, scene: { nodes: [], edges: [] }, preview: null });
      assert.equal(stopped.connection, null);
    };
  }
);

routingScenario(
  "a routing session whose edge is blocked by a movable node",
  "the obstacle moves and a failed scene is followed by a valid scene",
  "worker replaces routes when obstacles move and recovers after a failed scene",
  () => {
    const worker = routingWorker();
    const edge = { id: 'edge', source: 'a', target: 'b', sourceX: 0, sourceY: 0,
      targetX: 300, targetY: 0, sourcePosition: 'right', targetPosition: 'left' };
    const scene = { nodes: [{ id: 'blocker', x: 100, y: -30, width: 100, height: 60 }], edges: [edge] };
    const blocked = worker.send({ sceneRevision: 1, scene });
    return () => {
      assert.ok(blocked.routes.get('edge').length > 300);
      const moved = worker.send({ sceneRevision: 2, scene: { ...scene, nodes: [{ ...scene.nodes[0], y: 100 }] } });
      assert.equal(moved.routes.get('edge').length, 300);
      assert.equal(moved.sceneRevision, 2);
      assert.throws(() => worker.send({ sceneRevision: 3, scene: null }), TypeError,
        'invalid scenes propagate to the existing worker RPC error handler');
      const recovered = worker.send({ sceneRevision: 4, scene });
      assert.equal(recovered.error, undefined);
      assert.ok(recovered.routes.get('edge').length > 300);
    };
  }
);

routingScenario(
  "a routed preview that avoids an existing crossing arrow",
  "the preview is committed and an existing arrow is then removed",
  "releasing a connection retains its preview route and leaves existing arrows unchanged",
  () => {
    const worker = routingWorker();
    const existing = { id: 'a-existing', source: 'a', target: 'b', sourceX: 150, sourceY: -40,
      targetX: 150, targetY: 40, sourcePosition: 'bottom', targetPosition: 'top' };
    const added = { id: 'z-added', source: 'c', target: 'd', sourceX: 0, sourceY: 0,
      targetX: 300, targetY: 0, sourcePosition: 'right', targetPosition: 'left' };
    const before = worker.send({ sceneRevision: 1, scene: { nodes: [], edges: [existing] },
      preview: { ...added, id: '__connection-preview__' } });
    return () => {
      assert.ok(before.connection.length > 300, 'preview must exercise crossing avoidance');
      const released = worker.send({ sceneRevision: 2, scene: { nodes: [], edges: [existing, added] } });
      assert.deepEqual(released.routes.get(existing.id), before.routes.get(existing.id));
      assert.deepEqual(released.routes.get(added.id), before.connection);
      assert.equal(worker.sceneCalculations, 1, 'adding an arrow must not reroute the whole graph');

      const removed = worker.send({ sceneRevision: 3, scene: { nodes: [], edges: [added] } });
      assert.deepEqual(removed.routes.get(added.id), released.routes.get(added.id));
      assert.equal(removed.routes.size, 1);
    };
  }
);

routingScenario(
  "a preview approaching the same input as an existing lower arrow",
  "the shared-input preview is committed to the session",
  "a shared-input preview keeps its two-bend overlay on release",
  () => {
    const worker = routingWorker();
    const nodes = [
      { id: 'object', x: 0, y: 0, width: 100, height: 200 },
      { id: 'switch', x: 400, y: 240, width: 100, height: 80 },
    ];
    const lower = { id: 'lower', source: 'object', target: 'switch', sourceX: 100, sourceY: 140,
      targetX: 400, targetY: 260, sourcePosition: 'right', targetPosition: 'left' };
    const upper = { ...lower, id: 'upper', sourceY: 40 };
    const before = worker.send({ sceneRevision: 1, scene: { nodes, edges: [lower] },
      preview: { ...upper, id: '__connection-preview__' } });
    const released = worker.send({ sceneRevision: 2, scene: { nodes, edges: [lower, upper] } });
    return () => {
      assert.deepEqual(before.connection.points, [
        { x: 100, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 260 }, { x: 400, y: 260 },
      ]);
      assert.deepEqual(released.routes.get('upper'), before.connection);
      assert.deepEqual(released.routes.get('lower'), before.routes.get('lower'));
    };
  }
);

routingScenario(
  "a preview aligned with an existing parallel route section",
  "the aligned preview is committed to the session",
  "a preview aligns with an existing parallel section and retains that alignment on release",
  () => {
    const worker = routingWorker();
    const nodes = [
      { id: 'source', x: 0, y: 0, width: 120, height: 80 },
      { id: 'first', x: 250, y: -200, width: 120, height: 80 },
      { id: 'second', x: 400, y: -100, width: 120, height: 80 },
    ];
    const existing = { id: 'existing', source: 'source', target: 'first', sourceX: 125, sourceY: 40,
      targetX: 245, targetY: -160, sourcePosition: 'right', targetPosition: 'left' };
    const added = { ...existing, id: 'added', target: 'second', targetX: 395, targetY: -60 };
    const before = worker.send({ sceneRevision: 1, scene: { nodes, edges: [existing] }, preview: added });
    return () => {
      assert.deepEqual(before.connection.points, [
        { x: 125, y: 40 }, { x: 225, y: 40 }, { x: 225, y: -60 }, { x: 395, y: -60 },
      ]);
      const released = worker.send({ sceneRevision: 2, scene: { nodes, edges: [existing, added] } });
      assert.deepEqual(released.routes.get('added'), before.connection);
      assert.deepEqual(released.routes.get('existing'), before.routes.get('existing'));
    };
  }
);
