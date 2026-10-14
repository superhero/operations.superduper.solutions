<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { useSvelteFlow, useUpdateNodeInternals, Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { OperationData } from "$lib/workflow-document.ts";
  import WorkflowRestoreBranch from "./components/workflows/WorkflowRestoreBranch.svelte";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  const { getNodes } = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const branchesFor = getContext<((id: string) => Map<string, Branch> | undefined) | undefined>("workflow-branches");
  const inputConnected = getContext<((id: string, handleId?: string | null) => boolean) | undefined>("workflow-input-connected");
  let { id, data, selected }: NodeProps<Node<OperationData, "operation">> = $props();
  let hoveredRestore = $state<string>();
  const occurrences = $derived(getNodes().filter(node => node.type === "operation" && node.data.operationId === data.operationId));
  const ordinal = $derived(occurrences.length > 1 ? occurrences.findIndex(node => node.id === id) + 1 : 0);
  const branches = $derived(branchesFor?.(id));
  const connected = $derived(inputConnected?.(id) ?? false);
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

  function portLabel(label: string): string {
    return ({ "Path parameters": "Path", "Query parameters": "Query", "Request body": "Body" } as Record<string, string>)[label]
      ?? label.replace(/^Response · /, "").replace(/ · application\/json$/, " · JSON").replace(/ · text\/plain$/, " · Text");
  }
</script>

{#snippet portRow(direction: "inputs" | "outputs")}
  {@const input = direction === "inputs"}
  {@const group = ports[direction]}
  {@const position = input ? Position.Left : Position.Right}
  <div class="operation-ports" class:inputs={input} class:outputs={!input} aria-label={input ? "Input connections" : "Output connections"}>
    {#each group as branch (branch.id)}
      {@const label = portLabel(branch.label)}
      {@const separator = label.indexOf(" · ")}
      <HintButton label={branch.label} labelAsName={false} tabindex={-1} tooltipEnabled={hoveredRestore !== branch.id}
        onpointerover={event => hoveredRestore = event.target instanceof Element && event.target.closest(".workflow-restore-branch") ? branch.id : undefined}
        onpointerleave={() => hoveredRestore = undefined}>
        {#snippet child({ props })}
          {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
          <div {...hintProps} class="operation-port">
            <span class="port-label">{#if input}{label}{:else}<span class="port-code">{separator < 0 ? label : label.slice(0, separator)}</span>{separator < 0 ? "" : label.slice(separator)}{/if}</span>
            <span class="port-type">Object</span>
            <Handle id={branch.id} type={input ? "target" : "source"} {position}
              class="owner-port" style={`visibility: ${branch.hidden ? "hidden" : "visible"}`}
              isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
              onmousedown={blockPointer} ontouchstart={blockPointer}
              aria-disabled="true" aria-label={`${branch.label} ${input ? "input" : "output"}`} />
            {#if branch.hidden}<WorkflowRestoreBranch {branch} {position} />{/if}
          </div>
        {/snippet}
      </HintButton>
    {:else}
      {#if !portCount}
        <div class="operation-port">
          <span class="port-label">{input ? "Input" : "Output"}</span>
          <span class="port-type">Object</span>
          <Handle type={input ? "target" : "source"} {position} isConnectableStart={!input || !connected}
            isConnectableEnd={!input || !connected} aria-disabled={input && connected}
            aria-label={`${data.name} ${input ? "input" : "output"}`} />
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="operation-node" class:selected data-operation-name={data.name}>
  {@render portRow("inputs")}
  <HintButton label={`${data.method} ${data.path}\n${data.description}`} labelAsName={false} tabindex={-1}>
    {#snippet child({ props })}
      {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
      <div {...hintProps} class="operation-title-row">
        <MaterialIcon name="http" size={28} />
        <strong>{data.name}</strong>
        {#if ordinal}<span class="instance-pill" aria-label={`Instance ${ordinal}`}>{ordinal}</span>{/if}
      </div>
    {/snippet}
  </HintButton>
  <span class="sr-only">{data.method} {data.path}. {data.description}</span>
  {@render portRow("outputs")}
</div>

<style>
  .operation-node { position: relative; width: max-content; min-width: 160px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); box-shadow: none; transition: border-color 180ms ease-in, box-shadow 180ms ease-in; }
  .operation-title-row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 8px 12px; white-space: nowrap; }
  .operation-title-row strong { flex: 1 0 auto; }
  .operation-ports { display: grid; min-height: 12px; }
  .operation-ports.inputs { border-bottom: 1px solid var(--color-border); }
  .operation-ports.outputs { border-top: 1px solid var(--color-border); }
  .operation-port { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 34px; padding: 6px 14px; text-align: left; }
  .port-label { min-width: 0; flex: 1; font-size: 11px; overflow-wrap: anywhere; }
  .port-type { flex-shrink: 0; padding: 0 5px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-badge-foreground); font-size: 10px; line-height: 18px; }
  .port-code { white-space: nowrap; }
  .operation-node:hover:not(.selected) { border-color: var(--color-foreground); }
  :global(.svelte-flow__node:focus-visible) .operation-node { border-color: var(--color-emphasis); box-shadow: 0 0 0 1px var(--color-emphasis); }
  .instance-pill { flex-shrink: 0; min-width: 18px; padding: 0 5px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-badge-foreground); font: 12px/18px Rationale, sans-serif; font-variant-numeric: tabular-nums; text-align: center; }
  .selected { border-color: var(--color-emphasis); box-shadow: 0 0 0 1px var(--color-emphasis); }
  strong { font-size: 13px; font-weight: 600; }
  .operation-node :global(.material-symbols-rounded) { font-variation-settings: "FILL" 1; }
  .operation-node :global(.svelte-flow__handle) { width: 12px; height: 12px; border: 2px solid var(--color-surface); background: var(--color-emphasis); }
  .operation-node :global(.svelte-flow__handle.target) { background: var(--color-foreground); }
  .operation-node :global(.owner-port) { pointer-events: auto; cursor: default; }
  @media (prefers-reduced-motion: reduce) { .operation-node { transition: none; } }
</style>
