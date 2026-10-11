<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import { getSmoothStepPath, useConnection } from "@xyflow/svelte";
  import { workflowCurve } from "$lib/workflow-curve.ts";

  const connection = useConnection();
  const options = getContext<() => { curved: boolean; strength: number; style: string }>("workflow-connection-options");
  const path = $derived.by(() => {
    const state = connection.current;
    if (!state.inProgress) return "";
    const points = { sourceX: state.from.x, sourceY: state.from.y, sourcePosition: state.fromPosition,
      targetX: state.to.x, targetY: state.to.y, targetPosition: state.toPosition };
    return (options().curved ? workflowCurve(points, options().strength) : getSmoothStepPath(points))[0];
  });
</script>

<path d={path} style={options().style} fill="none" class="svelte-flow__connection-path" />
