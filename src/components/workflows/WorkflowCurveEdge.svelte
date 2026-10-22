<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import type { EdgeProps } from "@xyflow/svelte";
  import { workflowCurve } from "$lib/workflow-curve.ts";
  import { bezierDrawing } from "$lib/flow-routing/bezier.ts";
  import RoutedEdge from "$lib/flow-routing/RoutedEdge.svelte";

  import type { WorkflowLineStyle } from "$lib/workflow-line-style.ts";
  const options = getContext<() => { lineStyle: WorkflowLineStyle }>("workflow-connection-options");
  let props: EdgeProps = $props();
  const strength = getContext<() => number>("workflow-curve-strength");
</script>

<RoutedEdge {...props} splitDashes={false} fallback={workflowCurve(props, strength() * (options().lineStyle === "filleted" ? 1 : 0.5))}
  drawRoute={(route, points, obstacles, authored) => bezierDrawing(route, points, strength(), obstacles, authored, options().lineStyle)} />
