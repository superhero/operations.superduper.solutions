<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import type { EdgeProps } from "@xyflow/svelte";
  import { workflowCurve, workflowCurveRadius } from "$lib/workflow-curve.ts";
  import RoutedEdge from "$lib/flow-routing/RoutedEdge.svelte";

  let props: EdgeProps = $props();
  const strength = getContext<() => number>("workflow-curve-strength");
</script>

<RoutedEdge {...props} radius={workflowCurveRadius(strength())} splitDashes={false} fallback={workflowCurve(props, strength())} />
