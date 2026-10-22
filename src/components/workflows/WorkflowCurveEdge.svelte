<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import { BaseEdge, type EdgeProps } from "@xyflow/svelte";
  import { workflowCurve } from "$lib/workflow-curve.ts";
  import { bezierDrawing } from "$lib/flow-routing/bezier.ts";
  import RoutedEdge from "$lib/flow-routing/RoutedEdge.svelte";

  import type { WorkflowLineStyle } from "$lib/workflow-line-style.ts";
  const options = getContext<() => { lineStyle: WorkflowLineStyle }>("workflow-connection-options");
  let props: EdgeProps = $props();
  const strength = getContext<() => number>("workflow-curve-strength");
</script>

{#if options().lineStyle === "flowing"}
  {@const curve = workflowCurve(props, strength())}
  <BaseEdge id={props.id} path={curve[0]} labelX={curve[1]} labelY={curve[2]}
    label={props.label ?? ""} labelStyle={props.labelStyle ?? ""} style={props.style ?? ""}
    markerStart={props.markerStart ?? ""} markerEnd={props.markerEnd ?? ""} interactionWidth={props.interactionWidth ?? 20} />
{:else}
  <RoutedEdge {...props} splitDashes={false} fallback={workflowCurve(props, strength() * (options().lineStyle === "filleted" ? 1 : 0.5))}
    drawRoute={(route, points, obstacles, authored) => bezierDrawing(route, points, strength(), obstacles, authored, options().lineStyle)} />
{/if}
