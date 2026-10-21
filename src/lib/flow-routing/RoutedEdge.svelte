<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from 'svelte';
  import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
  import { routingContext, type DrawRoute, type RoutingContext } from './context.ts';
  import { bendRadius, routePath, routeMidpoint, projectRoute } from './path.js';
  import { dashSegments } from './dashes.js';
  import SegmentControls from './SegmentControls.svelte';
  import './dashes.css';

  let { radius = bendRadius, splitDashes = true, fallback, drawRoute, ...props }: EdgeProps & {
    radius?: number; splitDashes?: boolean; fallback?: [string, number, number]; drawRoute?: DrawRoute | undefined;
  } = $props();
  const routing = getContext<RoutingContext | undefined>(routingContext);
  let hovered = $state(false);
  let focused = $state(false);
  let group: SVGGElement;
  const obstacles = $derived(routing?.obstacles() ?? []);
  const projected = $derived(projectRoute(routing?.route(props.id), props));
  const drawing = $derived(projected && drawRoute?.(projected, props, obstacles, Boolean(routing?.manual(props.id) || routing?.route(props.id)?.manualState === 'applied')));
  const segments = $derived(props.animated && splitDashes ? dashSegments(projected, routing?.dashPeriod() ?? 10, radius, obstacles) : []);
  const geometry = $derived.by((): [string, number, number] => {
    if (drawing) return [drawing.path, drawing.midpoint.x, drawing.midpoint.y];
    if (projected) {
      const midpoint = routeMidpoint(projected, radius, obstacles)!;
      return [routePath(projected, radius, obstacles)!, midpoint.x, midpoint.y];
    }
    if (fallback) return fallback;
    const [path, x, y] = getSmoothStepPath({ ...props, borderRadius: bendRadius, stepPosition: 1 });
    return [path, x, y];
  });
</script>

<g bind:this={group} role="presentation" onpointerenter={() => hovered = true} onpointerleave={() => hovered = false}
  onfocusin={() => focused = true} onfocusout={event => focused = event.relatedTarget instanceof Node && group.contains(event.relatedTarget)}>
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
{#if routing?.editable() && projected && (hovered || focused || props.selected || routing.dragging(props.id))}
  <SegmentControls id={props.id} route={projected} {routing} {radius} {obstacles} drawing={drawing || undefined} />
{/if}
</g>
