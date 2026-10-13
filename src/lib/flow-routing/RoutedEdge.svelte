<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from 'svelte';
  import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
  import { routingContext, type RoutingContext } from './context.ts';
  import { bendRadius, routePath, routeMidpoint, projectRoute } from './path.js';
  import { dashSegments } from './dashes.js';
  import './dashes.css';

  let props: EdgeProps = $props();
  const routing = getContext<RoutingContext | undefined>(routingContext);
  const obstacles = $derived(routing?.obstacles() ?? []);
  const projected = $derived(projectRoute(routing?.route(props.id), props));
  const segments = $derived(props.animated ? dashSegments(projected, routing?.dashPeriod() ?? 10, bendRadius, obstacles) : []);
  const geometry = $derived.by((): [string, number, number] => {
    if (projected) {
      const midpoint = routeMidpoint(projected, bendRadius, obstacles)!;
      return [routePath(projected, bendRadius, obstacles)!, midpoint.x, midpoint.y];
    }
    const [path, x, y] = getSmoothStepPath({ ...props, borderRadius: bendRadius, stepPosition: 1 });
    return [path, x, y];
  });
</script>

<BaseEdge id={props.id} path={geometry[0]} class={segments.length ? 'flow-routing-path flow-routing-dash-base' : 'flow-routing-path'}
  labelX={geometry[1]} labelY={geometry[2]} label={props.label ?? ''} labelStyle={props.labelStyle ?? ''}
  markerStart={props.markerStart ?? ''} markerEnd={props.markerEnd ?? ''} style={props.style ?? ''} interactionWidth={props.interactionWidth ?? 20} />
{#if segments.length}
  <g class="flow-routing-dashes" pointer-events="none">
    {#each segments as segment, index}
      <path d={segment.path} class="svelte-flow__edge-path flow-routing-dash" fill="none"
        style={`${props.style ?? ''}; --flow-routing-dash-origin: ${segment.offset}px;`}
        marker-start={index === 0 ? props.markerStart : undefined}
        marker-end={index === segments.length - 1 ? props.markerEnd : undefined} />
    {/each}
  </g>
{/if}
