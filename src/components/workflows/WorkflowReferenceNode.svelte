<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { Handle, Position, useSvelteFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { WorkflowReferenceData } from "$lib/workflow-document.ts";
  import WorkflowRestoreBranch from "./WorkflowRestoreBranch.svelte";
  import "./workflow-owner-nodes.css";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  let { id, data, selected }: NodeProps<Node<WorkflowReferenceData, "workflow">> = $props();
  let hoveredRestore = $state<string>();
  const { getNodes } = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const branchesFor = getContext<(id: string) => Map<string, Branch> | undefined>("workflow-branches");
  const nameFor = getContext<(id: string) => string | undefined>("workflow-name");
  const displayName = $derived(nameFor(data.workflowId) || data.name);
  const occurrences = $derived(getNodes().filter(node => node.type === "workflow" && node.data.workflowId === data.workflowId));
  const ordinal = $derived(occurrences.length > 1 ? occurrences.findIndex(node => node.id === id) + 1 : 0);
  const branches = $derived(branchesFor(id));
  const ports = $derived({
    inputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "inputs"),
    outputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "outputs")
  });
  const layout = $derived(JSON.stringify([displayName, ordinal, ports]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
</script>

{#snippet portRow(direction: "inputs" | "outputs")}
  {@const input = direction === "inputs"}
  {@const position = input ? Position.Left : Position.Right}
  <div class="operation-ports" class:inputs={input} class:outputs={!input} aria-label={input ? "Input connections" : "Output connections"}>
    {#each ports[direction] as branch (branch.id)}
      <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label={branch.label} labelAsName={false} tabindex={-1} tooltipEnabled={hoveredRestore !== branch.id}
        onpointerover={event => hoveredRestore = event.target instanceof Element && event.target.closest(".workflow-restore-branch") ? branch.id : undefined}
        onpointerleave={() => hoveredRestore = undefined}>
        {#snippet child({ props })}
          {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
          <div {...hintProps} class="operation-port">
            <span class="port-label">{branch.label}</span><span class="port-type">Object</span>
            <Handle id={`schema:${branch.childId}`} type={input ? "target" : "source"} {position}
              class="owner-port"
              isConnectable={!input} isConnectableStart={!input} isConnectableEnd={false}
              onmousedown={blockPointer} ontouchstart={blockPointer} aria-disabled={input}
              aria-label={`${branch.label} ${input ? "input" : "output"}`} />
            {#if branch.hidden}<WorkflowRestoreBranch {branch} {position} />{/if}
          </div>
        {/snippet}
      </HintButton>
    {/each}
  </div>
{/snippet}

<div class="workflow-owner-node workflow-reference-node" class:selected data-workflow-name={displayName}>
  {@render portRow("inputs")}
  <div class="operation-title-row">
    <MaterialIcon name="flowsheet" size={28} /><strong>{displayName}</strong>
    {#if ordinal}<span class="instance-pill" aria-label={`Instance ${ordinal}`}>{ordinal}</span>{/if}
  </div>
  {@render portRow("outputs")}
</div>
