<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import HintButton from '../components/HintButton.svelte';
  import MaterialIcon from '../components/MaterialIcon.svelte';
  import { segmentHandles, type SegmentHandle } from './manual.js';
  import { routeMidpoint } from './path.js';
  import type { RoutingContext } from './context.ts';
  import type { Route } from './types.js';

  let { id, route, routing }: { id: string; route: Route; routing: RoutingContext } = $props();
  const flow = useSvelteFlow();
  const zoom = $derived(flow.getZoom());
  let group: SVGGElement;
  type PointerDrag = { pointerId: number; element: HTMLButtonElement; axis: 'x' | 'y';
    pointer: number; coordinate: number; viewport: string };
  let pointer = $state.raw<PointerDrag | null>(null);
  let keyboard = $state.raw<{ index: number; axis: 'x' | 'y'; coordinate: number } | null>(null);
  const handles = $derived.by(() => {
    const active = routing.dragHandle(id);
    return active ? [active] : segmentHandles(route);
  });
  const middle = $derived(routeMidpoint(route));
  const moving = $derived(Boolean(pointer || keyboard));

  function position(event: PointerEvent) {
    const matrix = group?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  }

  function start(event: PointerEvent, handle: SegmentHandle) {
    if (event.button !== 0 || !event.isPrimary || pointer || keyboard) return;
    event.preventDefault();
    event.stopPropagation();
    const at = position(event);
    if (!at) return;
    const started = routing.begin(id, handle.index);
    if (!started) return;
    const element = event.currentTarget as HTMLButtonElement;
    element.focus({ preventScroll: true });
    pointer = { pointerId: event.pointerId, element, axis: started.axis,
      pointer: at[started.axis], coordinate: started.coordinate, viewport: JSON.stringify(flow.getViewport()) };
    element.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (pointer?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const at = position(event);
    if (at) routing.move(id, pointer.coordinate + at[pointer.axis] - pointer.pointer);
  }

  function release(commit: boolean) {
    const captured = pointer;
    pointer = null;
    keyboard = null;
    if (commit) routing.finish(id);
    else routing.cancel(id);
    if (captured?.element.hasPointerCapture(captured.pointerId)) captured.element.releasePointerCapture(captured.pointerId);
  }

  function finish(event: PointerEvent) {
    if (pointer?.pointerId !== event.pointerId) return;
    move(event);
    release(true);
  }

  function cancel() { if (pointer || keyboard) release(false); }

  function keydown(event: KeyboardEvent, handle: SegmentHandle) {
    if (event.altKey || event.ctrlKey || event.metaKey || pointer) return;
    const negative = handle.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const positive = handle.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== negative && event.key !== positive) return;
    event.preventDefault();
    event.stopPropagation();
    if (!keyboard) {
      const started = routing.begin(id, handle.index);
      if (!started) return;
      keyboard = { index: handle.index, ...started };
    }
    routing.move(id, keyboard.coordinate + (event.key === negative ? -1 : 1) * (event.shiftKey ? 10 : 1));
    keyboard = { ...keyboard, coordinate: routing.dragHandle(id)?.[keyboard.axis] ?? keyboard.coordinate };
  }

  function keyup(event: KeyboardEvent) {
    if (keyboard && event.key.startsWith('Arrow')) {
      event.preventDefault();
      event.stopPropagation();
      release(true);
    }
  }

  function escape(event: KeyboardEvent) {
    if (event.key === 'Tab') { cancel(); return; }
    if (event.key === 'Escape' && (pointer || keyboard)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  }

  $effect(() => { if (moving && !routing.dragging(id)) cancel(); });
  $effect(() => { if (pointer && pointer.viewport !== JSON.stringify(flow.getViewport())) cancel(); });
  onDestroy(cancel);
</script>

<svelte:window onblur={cancel} onkeydowncapture={escape} />

<g bind:this={group} class="flow-routing-controls" role="presentation" onfocusout={() => { if (keyboard) cancel(); }}>
  {#if !moving && routing.manual(id) && middle}
    <!-- Behind the handles: a continuous hover target leading to reset. -->
    <line x1={middle.x} y1={middle.y} x2={middle.x + 20 / zoom} y2={middle.y - 20 / zoom}
      stroke="transparent" stroke-width={24 / zoom} stroke-linecap="round" pointer-events="stroke" />
  {/if}
  {#each handles as handle (handle.index)}
    <foreignObject x={-12} y={-12} width={24} height={24}
      transform={`translate(${handle.x} ${handle.y}) scale(${1 / zoom})`}>
      <HintButton class="flow-routing-segment-handle nokey nodrag nopan" data-segment-index={handle.index}
        data-axis={handle.axis} label="Move connection"
        aria-label={handle.axis === 'x' ? 'Move segment left or right' : 'Move segment up or down'}
        tooltipEnabled={!moving} onpointerdown={event => start(event, handle)} onpointermove={move}
        onpointerup={finish} onpointercancel={cancel} onlostpointercapture={cancel}
        onmousedown={event => event.stopPropagation()} onclick={event => event.stopPropagation()}
        ondblclick={event => event.stopPropagation()} onkeydown={event => keydown(event, handle)} onkeyup={keyup}>
        <span class="segment-dot"></span>
      </HintButton>
    </foreignObject>
  {/each}
  {#if !moving && routing.manual(id) && middle}
    <foreignObject x={-12} y={-12} width={24} height={24}
      transform={`translate(${middle.x + 20 / zoom} ${middle.y - 20 / zoom}) scale(${1 / zoom})`}>
      <HintButton class="flow-routing-reset nokey nodrag nopan" aria-label="Reset connection route"
        label="Reset connection"
        onpointerdown={event => event.stopPropagation()} onmousedown={event => event.stopPropagation()}
        onclick={event => { event.stopPropagation(); routing.resetRoute(id); }}>
        <MaterialIcon name="restart_alt" size={18} />
      </HintButton>
    </foreignObject>
  {/if}
</g>

<style>
  foreignObject { overflow: visible; pointer-events: all; }
  :global(.flow-routing-segment-handle), :global(.flow-routing-reset) {
    display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
    padding: 0; border: 0; border-radius: 50%; background: transparent; touch-action: none;
    color: var(--color-foreground); user-select: none;
  }
  :global(.flow-routing-segment-handle[data-axis="x"]) { cursor: ew-resize; }
  :global(.flow-routing-segment-handle[data-axis="y"]) { cursor: ns-resize; }
  .segment-dot { width: 10px; height: 10px; border: 1px solid var(--color-graph-line); border-radius: 50%; background: var(--color-accent); }
  :global(.flow-routing-segment-handle:is(:hover, :focus-visible)) .segment-dot { background: var(--color-foreground); border-color: var(--color-foreground); }
  :global(.flow-routing-reset) { background: var(--color-background); cursor: pointer; }
  @media (prefers-reduced-motion: no-preference) {
    .segment-dot { transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease; }
    :global(.flow-routing-segment-handle:is(:hover, :focus-visible)) .segment-dot { transform: scale(1.25); }
    :global(.flow-routing-reset) { transition: transform 180ms ease; }
    :global(.flow-routing-reset:is(:hover, :focus-visible)) { transform: scale(1.5); }
    .flow-routing-controls { animation: controls-in 150ms ease both; }
  }
  @keyframes controls-in { from { opacity: 0; } to { opacity: 1; } }
</style>
