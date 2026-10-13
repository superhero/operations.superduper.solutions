<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { setContext, untrack, type Snippet } from 'svelte';
  import { useConnection, useEdges, useNodes, useSvelteFlow } from '@xyflow/svelte';
  import { routingContext, type RoutingContext } from './context.ts';
  import { routingScene, connectionGeometry } from './geometry.js';
  import { cachedPreview } from './path.js';
  import { releasedPreview } from './handoff.js';
  import type { PreviewCache, Route, RoutingEdge, RoutingOptions } from './types.js';
  import type { RoutingRequest, RoutingReply } from './session.js';

  type ConnectionState = ReturnType<typeof useConnection>['current'];
  type Client = { calculate(input: RoutingRequest): Promise<RoutingReply>; dispose(): void };
  let { children, enabled = true, options = {}, dashPeriod = 10,
    resolveConnection = (value: ConnectionState) => value, createClient, onerror }:
    { children: Snippet; enabled?: boolean; options?: RoutingOptions; dashPeriod?: number;
      resolveConnection?: (value: ConnectionState) => ConnectionState;
      createClient: () => Client; onerror: (error: unknown) => void } = $props();
  const nodes = useNodes();
  const edges = useEdges();
  const flow = useSvelteFlow();
  const connection = useConnection();
  const scene = $derived(routingScene(nodes.current, edges.current, flow.getInternalNode));
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
    route: id => routes.get(id),
    obstacles: () => drawingObstacles,
    preview: () => cachedPreview(previewCache, preview, previewSession),
    connection: () => preview,
    dashPeriod: () => dashPeriod,
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
