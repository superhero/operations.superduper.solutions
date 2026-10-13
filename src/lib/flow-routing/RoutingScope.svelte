<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { setContext, untrack, type Snippet } from 'svelte';
  import { useConnection, useEdges, useNodes, useSvelteFlow } from '@xyflow/svelte';
  import { routingContext, type RouteChange, type RoutingContext } from './context.ts';
  import { routingScene, connectionGeometry } from './geometry.js';
  import { cachedPreview, projectRoute } from './path.js';
  import { normalizeManualRoute, prepareSegmentDrag, moveSegment, type SegmentDrag, type SegmentHandle } from './manual.js';
  import { releasedPreview } from './handoff.js';
  import type { Point, PreviewCache, Route, RoutingEdge, RoutingOptions } from './types.js';
  import type { RoutingRequest, RoutingReply } from './session.js';

  type ConnectionState = ReturnType<typeof useConnection>['current'];
  type Client = { calculate(input: RoutingRequest): Promise<RoutingReply>; dispose(): void };
  let { children, enabled = true, editable = true, options = {}, dashPeriod = 10,
    resolveConnection = (value: ConnectionState) => value, createClient, onerror, onroutechange }:
    { children: Snippet; enabled?: boolean; editable?: boolean; options?: RoutingOptions; dashPeriod?: number;
      resolveConnection?: (value: ConnectionState) => ConnectionState;
      createClient: () => Client; onerror: (error: unknown) => void; onroutechange: RouteChange } = $props();
  const nodes = useNodes();
  const edges = useEdges();
  const flow = useSvelteFlow();
  const connection = useConnection();
  const scene = $derived(routingScene(nodes.current, edges.current, flow.getInternalNode));
  const currentSceneKey = $derived(JSON.stringify([scene, options]));
  type Draft = { id: string; route: Route; sceneKey: string;
    drag?: SegmentDrag; handle?: SegmentHandle };
  let draft = $state.raw<Draft | null>(null);
  let committed = $state.raw(new Map<string, { route: Route; points: Point[] | undefined }>());
  // Rounded corners must respect the same clearance as the orthogonal search.
  const drawingObstacles = $derived.by(() => {
    const padding = options.nodePadding ?? 12;
    return scene.nodes.map(node => ({ ...node, x: node.x - padding, y: node.y - padding,
      width: node.width + 2 * padding, height: node.height + 2 * padding }));
  });
  const preview = $derived(connectionGeometry(resolveConnection(connection.current)));
  let routes = $state.raw(new Map<string, Route>());
  let previewCache = $state.raw<PreviewCache | null>(null);
  let previewSession = $state(0);
  let wasPreviewing = false;
  let lastPreview: RoutingEdge | null = null;
  let client = $state.raw<Client | null>(null);
  let sceneRevision = 0;
  let sceneKey: string | undefined;
  let requestedKey: string | undefined;
  let pending: (RoutingRequest & { previewSession: number }) | undefined;
  let active = false;
  let frame: number | undefined;

  setContext<RoutingContext>(routingContext, {
    route: id => draft?.id === id ? draft.route : committed.get(id)?.route ?? routes.get(id),
    obstacles: () => drawingObstacles,
    preview: () => cachedPreview(previewCache, preview, previewSession),
    connection: () => preview,
    dashPeriod: () => dashPeriod,
    editable: () => enabled && editable && client !== null,
    manual: id => Boolean(scene.edges.find(edge => edge.id === id)?.manualRoute),
    manualState: id => routes.get(id)?.manualState,
    dragging: id => draft?.id === id && Boolean(draft.drag),
    dragHandle: id => draft?.id === id ? draft.handle ?? null : null,
    begin, move, finish,
    cancel: id => { if (draft?.id === id) draft = null; },
    resetRoute,
  });

  function begin(id: string, index: number) {
    if (!enabled || !editable || !client) return null;
    const edge = scene.edges.find(edge => edge.id === id);
    if (!edge) return null;
    const route = projectRoute(draft?.id === id ? draft.route : committed.get(id)?.route ?? routes.get(id), edge);
    if (!route) return null;
    const drag = prepareSegmentDrag(route, index, edge, scene.nodes, options);
    if (!drag) return null;
    const a = drag.points[drag.movingIndices[0]]!, b = drag.points[drag.movingIndices[1]]!;
    draft = { id, route, drag, sceneKey: currentSceneKey,
      handle: { index, axis: drag.axis, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    return { axis: drag.axis, coordinate: drag.startCoordinate };
  }

  function move(id: string, coordinate: number) {
    const current = draft;
    if (current?.id !== id || !current.drag || !current.handle) return;
    const moved = moveSegment(current.drag, coordinate);
    draft = { ...current, route: moved.route,
      handle: { ...current.handle, [current.drag.axis]: moved.coordinate } };
  }

  function commit(current: Draft, points: Point[] | undefined) {
    // Pending committed displays are independent of the active gesture. A later
    // cancelled drag (even on another edge) cannot reveal an older cached path.
    committed = new Map(committed).set(current.id, { route: current.route, points });
    draft = null;
    onroutechange(current.id, points);
  }

  function finish(id: string) {
    const current = draft;
    if (current?.id !== id || !current.drag) return;
    const points = normalizeManualRoute(current.route.points);
    if (!enabled || !editable || current.sceneKey !== currentSceneKey || !points ||
      JSON.stringify(points) === JSON.stringify(current.drag.original)) { draft = null; return; }
    commit(current, points);
  }

  function resetRoute(id: string) {
    if (!enabled || !editable || !client || !scene.edges.find(edge => edge.id === id)?.manualRoute) return;
    const route = draft?.id === id ? draft.route : committed.get(id)?.route ?? routes.get(id);
    if (route) commit({ id, route, sceneKey: currentSceneKey }, undefined);
  }

  $effect(() => {
    const allowed = enabled && editable, key = currentSceneKey, current = draft;
    if (current && (!allowed || key !== current.sceneKey))
      untrack(() => { draft = null; });
  });

  $effect(() => {
    // Undo, reset from another editor, hidden edges and graph replacement must
    // not retain a pending display for an intent that is no longer current.
    const current = scene.edges;
    untrack(() => {
      const retained = new Map([...committed].filter(([id, value]) => {
        const edge = current.find(edge => edge.id === id);
        return edge && JSON.stringify(edge.manualRoute) === JSON.stringify(value.points);
      }));
      if (retained.size !== committed.size) committed = retained;
    });
  });

  function reset() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    pending = undefined;
    active = false;
    requestedKey = sceneKey = undefined;
    routes = new Map();
    previewCache = null;
    wasPreviewing = false;
    lastPreview = null;
    previewSession++;
    sceneRevision++;
    draft = null;
    committed = new Map();
  }

  // One calculation in flight and only the newest pending pointer/scene snapshot.
  // Both the scene revision and drag session must match before reusing a reply.
  function schedule() {
    if (active || frame !== undefined || !pending || !client) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const instance = client;
      const input = pending;
      if (!instance || !input) return;
      active = true;
      pending = undefined;
      void instance.calculate(input).then(data => {
        if (client !== instance) return;
        if (data.sceneRevision === sceneRevision) {
          routes = data.routes;
          committed = new Map([...committed].filter(([id, value]) => {
            const edge = input.scene.edges.find(edge => edge.id === id);
            return !edge || JSON.stringify(edge.manualRoute) !== JSON.stringify(value.points);
          }));
          if (input.previewSession === previewSession) {
            previewCache = data.connection && data.preview
              ? { route: data.connection, geometry: data.preview, session: input.previewSession } : null;
          }
        }
        active = false;
        schedule();
      }).catch(error => {
        if (client !== instance) return;
        client = null;
        instance.dispose();
        reset();
        onerror(error);
      });
    });
  }

  $effect(() => {
    if (!enabled) return;
    const instance = untrack(createClient);
    client = instance;
    return () => {
      client = null;
      instance.dispose();
      reset();
    };
  });

  $effect(() => {
    const input = { scene, preview, options };
    const key = JSON.stringify(input);
    if (!enabled || !client || key === requestedKey) return;
    untrack(() => {
      const nextSceneKey = JSON.stringify([input.scene, options]);
      if (nextSceneKey !== sceneKey) {
        // Carry the snapped route to its new edge before invalidating the drag.
        for (const edge of input.scene.edges) {
          if (routes.has(edge.id)) continue;
          const released = releasedPreview(previewCache, lastPreview, previewSession, edge);
          if (released) { routes = new Map(routes).set(edge.id, released); break; }
        }
        sceneKey = nextSceneKey;
        sceneRevision++;
        previewCache = null;
      }
      if (Boolean(input.preview) !== wasPreviewing) {
        wasPreviewing = Boolean(input.preview);
        previewSession++;
        previewCache = null;
      }
      lastPreview = input.preview;
      requestedKey = key;
      pending = { ...input, sceneRevision, previewSession };
      schedule();
    });
  });
</script>

{@render children()}
