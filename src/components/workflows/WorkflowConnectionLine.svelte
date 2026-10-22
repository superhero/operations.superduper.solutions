<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import type { Position } from "@xyflow/svelte";
  import { workflowCurve } from "$lib/workflow-curve.ts";
  import { bezierDrawing } from "$lib/flow-routing/bezier.ts";
  import { bendRadius } from "$lib/flow-routing/path.js";
  import RoutedConnection from "$lib/flow-routing/RoutedConnection.svelte";

  import type { WorkflowLineStyle } from "$lib/workflow-line-style.ts";
  const options = getContext<() => { curved: boolean; lineStyle: WorkflowLineStyle; strength: number; style: string }>("workflow-connection-options");
</script>

<RoutedConnection radius={bendRadius * (options().curved ? 1 : options().strength / 100)} style={options().style} direct={options().lineStyle === "flowing"}
  drawRoute={options().curved ? (route, points, obstacles) => bezierDrawing(route, points, options().strength, obstacles, false, options().lineStyle) : undefined}
  curve={options().curved ? points => workflowCurve({ ...points,
  sourcePosition: points.sourcePosition as Position, targetPosition: points.targetPosition as Position }, options().strength * (options().lineStyle === "filleted" || options().lineStyle === "flowing" ? 1 : 0.5))[0] : undefined} />
