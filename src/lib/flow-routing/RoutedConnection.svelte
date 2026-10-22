<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from 'svelte';
  import { getSmoothStepPath, useConnection, useViewport, type Position } from '@xyflow/svelte';
  import { routingContext, type DrawRoute, type RoutingContext } from './context.ts';
  import { pointerGeometry } from './geometry.js';
  import { bendRadius, previewPath, previewRoute } from './path.js';
  import type { RoutingEdge } from './types.js';

  let { style, curve, drawRoute, direct = false, radius = bendRadius }: { style?: string; curve?: ((edge: RoutingEdge) => string) | undefined; drawRoute?: DrawRoute | undefined; direct?: boolean; radius?: number } = $props();
  const routing = getContext<RoutingContext | undefined>(routingContext);
  const connection = useConnection();
  const viewport = useViewport();
  const pointer = $derived(pointerGeometry(connection.current, viewport.current));
  const path = $derived.by(() => {
    if (!pointer) return null;
    if (direct && curve) return curve(pointer);
    const route = previewRoute(routing?.preview(), pointer);
    if (route && drawRoute) return drawRoute(route, pointer, routing?.obstacles() ?? [], false).path;
    return previewPath(routing?.preview(), pointer, radius, routing?.obstacles() ?? []) ?? curve?.(pointer) ??
      getSmoothStepPath({ ...pointer, sourcePosition: pointer.sourcePosition as Position,
        targetPosition: pointer.targetPosition as Position, borderRadius: radius, stepPosition: 1 })[0];
  });
</script>

{#if path}
  <path d={path} {style} fill="none" class="svelte-flow__connection-path" />
{/if}
