<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import { Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { StopData } from "$lib/workflow-document.ts";
  import "./workflow-utility-nodes.css";

  let { id, selected }: NodeProps<Node<StopData, "stop">> = $props();
  const inputConnected = getContext<(id: string, handle: string) => boolean>("workflow-input-connected");
  const inputTypeFor = getContext<(id: string) => string>("workflow-input-type");
  const connected = $derived(inputConnected(id, "value"));
  const inputType = $derived(inputTypeFor(id));
</script>

<div class="workflow-utility-node workflow-stop-node" class:selected>
  <div class="utility-title">
    <Handle id="value" type="target" position={Position.Left} isConnectableStart={false}
      isConnectableEnd={!connected} aria-disabled={connected} aria-label={`Stop input (${inputType})`} />
    <MaterialIcon name="stop_circle" size={20} /><strong>Stop</strong><span class="utility-type">{inputType}</span>
  </div>
</div>

<style>
  .workflow-stop-node { width: 220px; }
</style>
