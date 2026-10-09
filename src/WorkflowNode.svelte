<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { useSvelteFlow, useUpdateNodeInternals, Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { OperationData } from "$lib/workflow-document.ts";
  import WorkflowRestoreBranch from "./components/workflows/WorkflowRestoreBranch.svelte";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  const { getNodes } = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const branchesFor = getContext<((id: string) => Map<string, Branch> | undefined) | undefined>("workflow-branches");
  let { id, data, selected }: NodeProps<Node<OperationData, "operation">> = $props();
  const occurrences = $derived(getNodes().filter(node => node.type === "operation" && node.data.operationId === data.operationId));
  const ordinal = $derived(occurrences.length > 1 ? occurrences.findIndex(node => node.id === id) + 1 : 0);
  const branches = $derived(branchesFor?.(id));
  const ports = $derived({
    inputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "inputs"),
    outputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "outputs")
  });
  const portCount = $derived(Math.max(ports.inputs.length, ports.outputs.length));
  const layout = $derived(JSON.stringify([data.name, ordinal, ports]));

  $effect(() => {
    layout;
    untrack(() => updateNodeInternals(id));
  });

  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
</script>

<div class="operation-node" class:selected data-operation-name={data.name}
  style:min-height={`${Math.max(88, portCount * 28 + 28)}px`} title={`${data.method} ${data.path}\n${data.description}`}>
  <MaterialIcon name="http" size={28} />
  <strong>{data.name}</strong>
  {#if ordinal}<span class="instance-pill" aria-label={`Instance ${ordinal}`}>{ordinal}</span>{/if}
  <span class="sr-only">{data.method} {data.path}. {data.description}</span>
  {#if portCount}
    {#each ["inputs", "outputs"] as direction}
      {@const input = direction === "inputs"}
      {@const group = input ? ports.inputs : ports.outputs}
      {@const position = input ? Position.Left : Position.Right}
      {#each group as branch, index (branch.id)}
        {@const top = `calc(50% + ${(index - (group.length - 1) / 2) * 28}px)`}
        <Handle id={`schema:${branch.childId}`} type={input ? "target" : "source"} {position}
          class="owner-port" style={`top: ${top}; visibility: ${branch.hidden ? "hidden" : "visible"}`}
          isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
          onmousedown={blockPointer} ontouchstart={blockPointer}
          aria-disabled="true" aria-label={`${branch.label} ${input ? "input" : "output"}`} title={branch.label} />
        {#if branch.hidden}<WorkflowRestoreBranch {branch} {position} {top} />{/if}
      {/each}
    {/each}
  {:else}
    <Handle type="target" position={Position.Left} aria-label={`${data.name} input`} />
    <Handle type="source" position={Position.Right} aria-label={`${data.name} output`} />
  {/if}
</div>

<style>
  .operation-node { position: relative; display: grid; justify-items: center; align-content: center; gap: 6px; width: 160px; padding: 14px 20px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); text-align: center; box-shadow: none; transition: border-color 180ms ease-in, box-shadow 180ms ease-in; }
  .operation-node:hover:not(.selected) { border-color: var(--color-foreground); }
  :global(.svelte-flow__node:focus-visible) .operation-node { border-color: var(--color-emphasis); box-shadow: 0 0 0 1px var(--color-emphasis); }
  .instance-pill { position: absolute; top: 5px; right: 5px; min-width: 18px; padding: 0 5px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-badge-foreground); font: 12px/18px Rationale, sans-serif; font-variant-numeric: tabular-nums; }
  .selected { border-color: var(--color-emphasis); box-shadow: 0 0 0 1px var(--color-emphasis); }
  strong { max-width: 100%; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
  .operation-node :global(.material-symbols-rounded) { font-variation-settings: "FILL" 1; }
  .operation-node :global(.svelte-flow__handle) { width: 12px; height: 12px; border: 2px solid var(--color-surface); background: var(--color-emphasis); }
  .operation-node :global(.svelte-flow__handle.target) { background: var(--color-foreground); }
  .operation-node :global(.owner-port) { pointer-events: auto; cursor: default; }
  @media (prefers-reduced-motion: reduce) { .operation-node { transition: none; } }
</style>
