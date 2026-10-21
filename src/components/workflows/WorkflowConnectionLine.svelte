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
  import RoutedConnection from "$lib/flow-routing/RoutedConnection.svelte";

  const options = getContext<() => { curved: boolean; strength: number; style: string }>("workflow-connection-options");
</script>

<RoutedConnection style={options().style}
  drawRoute={options().curved ? (route, points, obstacles) => bezierDrawing(route, points, options().strength, obstacles) : undefined}
  curve={options().curved ? points => workflowCurve({ ...points,
  sourcePosition: points.sourcePosition as Position, targetPosition: points.targetPosition as Position }, options().strength)[0] : undefined} />
