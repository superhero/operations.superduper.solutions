<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import { BaseEdge, type EdgeProps } from "@xyflow/svelte";
  import { workflowCurve } from "$lib/workflow-curve.ts";

  let props: EdgeProps = $props();
  const strength = getContext<() => number>("workflow-curve-strength");
  const curve = $derived(workflowCurve(props, strength()));
</script>

<BaseEdge id={props.id} path={curve[0]} labelX={curve[1]} labelY={curve[2]}
  label={props.label ?? ""} labelStyle={props.labelStyle ?? ""} style={props.style ?? ""}
  markerStart={props.markerStart ?? ""} markerEnd={props.markerEnd ?? ""} interactionWidth={props.interactionWidth ?? 20} />
