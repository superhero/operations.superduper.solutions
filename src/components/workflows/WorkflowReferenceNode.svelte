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
  const occurrences = $derived(getNodes().filter(node => node.type === "workflow" && node.data.workflowId === data.workflowId));
  const ordinal = $derived(occurrences.length > 1 ? occurrences.findIndex(node => node.id === id) + 1 : 0);
  const branches = $derived(branchesFor(id));
  const ports = $derived({
    inputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "inputs"),
    outputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "outputs")
  });
  const layout = $derived(JSON.stringify([data.name, ordinal, ports]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
</script>

{#snippet portRow(direction: "inputs" | "outputs")}
  {@const input = direction === "inputs"}
  {@const position = input ? Position.Left : Position.Right}
  <div class="operation-ports" class:inputs={input} class:outputs={!input} aria-label={input ? "Input connections" : "Output connections"}>
    {#each ports[direction] as branch (branch.id)}
      <HintButton label={branch.label} labelAsName={false} tabindex={-1} tooltipEnabled={hoveredRestore !== branch.id}
        onpointerover={event => hoveredRestore = event.target instanceof Element && event.target.closest(".workflow-restore-branch") ? branch.id : undefined}
        onpointerleave={() => hoveredRestore = undefined}>
        {#snippet child({ props })}
          {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
          <div {...hintProps} class="operation-port">
            <span class="port-label">{branch.label}</span><span class="port-type">Object</span>
            <Handle id={`schema:${branch.childId}`} type={input ? "target" : "source"} {position}
              class="owner-port" style={`visibility: ${branch.hidden ? "hidden" : "visible"}`}
              isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
              onmousedown={blockPointer} ontouchstart={blockPointer} aria-disabled="true"
              aria-label={`${branch.label} ${input ? "input" : "output"}`} />
            {#if branch.hidden}<WorkflowRestoreBranch {branch} {position} />{/if}
          </div>
        {/snippet}
      </HintButton>
    {/each}
  </div>
{/snippet}

<div class="workflow-owner-node workflow-reference-node" class:selected data-workflow-name={data.name}>
  {@render portRow("inputs")}
  <HintButton label={data.description} labelAsName={false} tooltipEnabled={Boolean(data.description)} tabindex={-1}>
    {#snippet child({ props })}
      {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
      <div {...hintProps} class="operation-title-row">
        <MaterialIcon name="flowsheet" size={28} /><strong>{data.name}</strong>
        {#if ordinal}<span class="instance-pill" aria-label={`Instance ${ordinal}`}>{ordinal}</span>{/if}
      </div>
    {/snippet}
  </HintButton>
  {@render portRow("outputs")}
</div>
