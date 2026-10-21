<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import type { Position } from "@xyflow/svelte";
  import { workflowCurve, workflowCurveRadius } from "$lib/workflow-curve.ts";
  import { bendRadius } from "$lib/flow-routing/path.js";
  import RoutedConnection from "$lib/flow-routing/RoutedConnection.svelte";

  const options = getContext<() => { curved: boolean; strength: number; style: string }>("workflow-connection-options");
</script>

<RoutedConnection style={options().style} radius={options().curved ? workflowCurveRadius(options().strength) : bendRadius} curve={options().curved ? points => workflowCurve({ ...points,
  sourcePosition: points.sourcePosition as Position, targetPosition: points.targetPosition as Position }, options().strength)[0] : undefined} />
