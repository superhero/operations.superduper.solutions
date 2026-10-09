<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { Handle, Position, useSvelteFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { WorkflowReferenceData } from "$lib/workflow-document.ts";
  import WorkflowRestoreBranch from "./WorkflowRestoreBranch.svelte";
  import "./workflow-utility-nodes.css";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  let { id, data, selected }: NodeProps<Node<WorkflowReferenceData, "workflow">> = $props();
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
  const portCount = $derived(Math.max(ports.inputs.length, ports.outputs.length));
  const layout = $derived(JSON.stringify([data.name, ordinal, ports]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
</script>

<div class="workflow-utility-node workflow-reference-node" class:selected data-workflow-name={data.name}
  style:min-height={`${Math.max(88, portCount * 28 + 28)}px`} title={data.description}>
  <div class="workflow-kind"><MaterialIcon name="flowsheet" size={20} /><span>Workflow</span></div>
  <strong>{data.name}</strong>
  {#if ordinal}<span class="instance-pill" aria-label={`Instance ${ordinal}`}>{ordinal}</span>{/if}
  {#each ["inputs", "outputs"] as direction}
    {@const input = direction === "inputs"}
    {@const group = input ? ports.inputs : ports.outputs}
    {@const position = input ? Position.Left : Position.Right}
    {#each group as branch, index (branch.id)}
      {@const top = `calc(50% + ${(index - (group.length - 1) / 2) * 28}px)`}
      <Handle id={`schema:${branch.childId}`} type={input ? "target" : "source"} {position}
        class="owner-port" style={`top: ${top}; visibility: ${branch.hidden ? "hidden" : "visible"}`}
        isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
        onmousedown={blockPointer} ontouchstart={blockPointer} aria-disabled="true"
        aria-label={`${branch.label} ${input ? "input" : "output"}`} title={branch.label} />
      {#if branch.hidden}<WorkflowRestoreBranch {branch} {position} {top} />{/if}
    {/each}
  {/each}
</div>

<style>
  .workflow-reference-node { display: grid; align-content: center; justify-items: center; gap: 6px; width: 160px; padding: 14px 20px; text-align: center; }
  .workflow-kind { display: flex; align-items: center; gap: 5px; color: var(--color-muted-foreground); font-size: 10px; }
  strong { max-width: 100%; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
  .instance-pill { position: absolute; top: 5px; right: 5px; min-width: 18px; padding: 0 5px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-badge-foreground); font: 12px/18px Rationale, sans-serif; font-variant-numeric: tabular-nums; }
  .workflow-reference-node :global(.owner-port) { pointer-events: auto; cursor: default; }
</style>
