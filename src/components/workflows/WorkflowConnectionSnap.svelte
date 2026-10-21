<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext } from "svelte";
  import { getSmoothStepPath, useConnection, useNodes, useStore, useSvelteFlow, useViewport,
    ViewportPortal, type Connection, type InternalNode, type XYPosition, type Position } from "@xyflow/svelte";
  import { nearestWorkflowInput, type WorkflowConnectionState, type WorkflowConnectionEnd,
    type WorkflowHandle } from "$lib/workflow-connection-snap.ts";
  import { workflowCurve, workflowCurveRadius } from "$lib/workflow-curve.ts";
  import { defaultWorkflowSettings } from "$lib/app-settings.ts";
  import { routingContext, type RoutingContext } from "$lib/flow-routing/context.ts";
  import { connectionGeometry } from "$lib/flow-routing/geometry.js";
  import { bendRadius, previewPath } from "$lib/flow-routing/path.js";

  let { isValidConnection, active = true, curved = false, dashed = false, curveStrength = defaultWorkflowSettings.curveStrength, markerEnd }:
    { isValidConnection: (connection: Connection) => boolean; active?: boolean; curved?: boolean;
      dashed?: boolean; curveStrength?: number; markerEnd?: string } = $props();
  const connection = useConnection();
  const nodes = useNodes();
  const viewport = useViewport();
  const flow = useSvelteFlow();
  const store = useStore();
  const routing = getContext<RoutingContext | undefined>(routingContext);
  let cancelled = $state(false);

  export function start() { cancelled = false; }
  export function acceptsConnection(): boolean { return active && !cancelled; }

  // Handle bounds contain geometry only. Check the actual port as well so collapsed,
  // hidden and disabled fields cannot attract a connection through their old bounds.
  function available(node: InternalNode, handle: WorkflowHandle): boolean {
    const panel = store.domNode?.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${CSS.escape(node.id)}"]`);
    const element = Array.from(panel?.querySelectorAll<HTMLElement>(".svelte-flow__handle.target") ?? [])
      .find(element => element.getAttribute("data-handleid") === (handle.id ?? null));
    if (!element || !element.classList.contains("connectable") || !element.classList.contains("connectableend") ||
        element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    if (typeof element.checkVisibility === "function")
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
  }

  function target(state: WorkflowConnectionState | WorkflowConnectionEnd, pointer: XYPosition) {
    if (!acceptsConnection() || !store.nodesConnectable) return null;
    return nearestWorkflowInput(state, nodes.current.map(node => flow.getInternalNode(node.id)), pointer,
      isValidConnection, available);
  }

  export function preview(state: WorkflowConnectionState): WorkflowConnectionState {
    if (!state.inProgress) return state;
    const { x, y, zoom } = viewport.current;
    const snapped = target(state, { x: (state.pointer.x - x) / zoom, y: (state.pointer.y - y) / zoom });
    return snapped ? {
      ...state, isValid: true, toNode: snapped.node, to: snapped.point,
      toHandle: { ...snapped.handle, type: "target", nodeId: snapped.node.id }, toPosition: snapped.handle.position
    } : state;
  }

  export function drop(event: MouseEvent | TouchEvent, state: WorkflowConnectionEnd): Connection | null {
    // Svelte Flow commits native valid drops before calling onconnectend.
    if (!acceptsConnection() || state.isValid === true || !connection.current.inProgress ||
        state.fromNode?.id !== connection.current.fromNode.id ||
        state.fromHandle?.id !== connection.current.fromHandle.id ||
        !["mouseup", "touchend"].includes(event.type)) return null;
    const pointer = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!pointer) return null;
    const position = flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }, { snapToGrid: false });
    return target(state, position)?.connection ?? null;
  }

  function cancel() {
    if (!connection.current.inProgress && !store.clickConnectStartHandle) return;
    cancelled = true;
    store.clickConnectStartHandle = null;
    store.cancelConnection();
  }
  $effect(() => { if (!active) cancel(); });
  const resolved = $derived(preview(connection.current));
  const path = $derived.by(() => {
    if (!resolved.inProgress || !resolved.isValid || !resolved.toNode) return "";
    const geometry = connectionGeometry(resolved)!;
    const points = { ...geometry, sourcePosition: geometry.sourcePosition as Position, targetPosition: geometry.targetPosition as Position };
    return previewPath(routing?.preview(), points, curved ? workflowCurveRadius(curveStrength) : bendRadius, routing?.obstacles() ?? []) ??
      (curved ? workflowCurve(points, curveStrength)[0] :
      getSmoothStepPath({ ...points, borderRadius: bendRadius, stepPosition: 1 })[0]);
  });
</script>

<svelte:window onblur={cancel} onpointercancel={cancel} onkeydown={event => { if (event.key === "Escape") cancel(); }} />

{#if path && resolved.inProgress}
  <ViewportPortal target="front" style="pointer-events: none;">
    <svg class="workflow-connection-preview" aria-hidden="true" width="1" height="1"
      data-source={resolved.fromNode.id} data-source-handle={resolved.fromHandle.id}
      data-target={resolved.toNode?.id} data-target-handle={resolved.toHandle?.id}>
      <path d={path} fill="none" marker-end={markerEnd} style:stroke-dasharray={dashed ? "var(--workflow-dash-length, 6) var(--workflow-dash-gap, 4)" : undefined} />
      <circle cx={resolved.to.x} cy={resolved.to.y} r="6" />
    </svg>
  </ViewportPortal>
{/if}

<style>
  .workflow-connection-preview { position: absolute; left: 0; top: 0; overflow: visible; opacity: 0.35; pointer-events: none; }
  path { stroke: var(--color-emphasis); stroke-width: 2; }
  circle { fill: var(--color-emphasis); stroke: var(--color-surface); stroke-width: 2; }
</style>
