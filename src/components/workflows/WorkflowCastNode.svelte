<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext } from "svelte";
  import { Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { CastData } from "$lib/workflow-document.ts";
  import { castTypes } from "$lib/workflow-utilities.ts";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import "./workflow-utility-nodes.css";

  let { id, data, selected }: NodeProps<Node<CastData, "cast">> = $props();
  const changeType = getContext<(id: string, targetType: CastData["targetType"]) => void>("workflow-cast-type");
  const inputTypeFor = getContext<(id: string) => string>("workflow-input-type");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const inputConnected = getContext<((id: string, handleId?: string | null) => boolean) | undefined>("workflow-input-connected");
  const connected = $derived(inputConnected?.(id, "value") ?? false);
  const inputType = $derived(inputTypeFor(id));
</script>

<div class="workflow-utility-node workflow-cast-node" class:selected>
  <div class="utility-title">
    <Handle id="value" type="target" position={Position.Left} isConnectableStart={false}
      isConnectableEnd={!connected} aria-disabled={connected} aria-label={`Cast input (${inputType})`} />
    <MaterialIcon name="transform" size={20} /><strong>Cast</strong><span class="utility-type">{inputType}</span>
  </div>
  <div class="utility-row cast-type nodrag nopan nokey">
    <WorkflowNodeSelect label="Cast output type" value={data.targetType} active={editorActive?.() ?? true}
      choices={castTypes}
      onchange={type => changeType(id, type as CastData["targetType"])} />
    <Handle id="result" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`${data.targetType} output`} />
  </div>
</div>

<style>
  .workflow-cast-node { width: 220px; }
</style>
