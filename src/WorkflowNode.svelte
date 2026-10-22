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
  import WorkflowNodeSelect from "./components/workflows/WorkflowNodeSelect.svelte";
  import "./components/workflows/workflow-owner-nodes.css";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  const { getNodes } = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const branchesFor = getContext<((id: string) => Map<string, Branch> | undefined) | undefined>("workflow-branches");
  const inputConnected = getContext<((id: string, handleId?: string | null) => boolean) | undefined>("workflow-input-connected");
  const pathFor = getContext<((operationId: string) => string[] | undefined) | undefined>("workflow-operation-path");
  const versionsFor = getContext<{
    choices: (operationId: string) => { value: string; label: string; disabled?: boolean }[];
    pending: () => boolean;
    active: () => boolean;
    select: (nodeId: string, operationId: string) => Promise<void>;
  } | undefined>("workflow-operation-version");
  let { id, data, selected }: NodeProps<Node<OperationData, "operation">> = $props();
  let hoveredRestore = $state<string>();
  const categoryPath = $derived(pathFor?.(data.operationId));
  const occurrences = $derived(getNodes().filter(node => node.type === "operation" && node.data.operationId === data.operationId));
  const ordinal = $derived(occurrences.length > 1 ? occurrences.findIndex(node => node.id === id) + 1 : 0);
  const branches = $derived(branchesFor?.(id));
  const connected = $derived(inputConnected?.(id) ?? false);
  const versions = $derived(versionsFor?.choices(data.operationId) ?? []);
  const ports = $derived({
    inputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "inputs"),
    outputs: [...(branches?.values() ?? [])].filter(branch => branch.direction === "outputs")
  });
  const portCount = $derived(Math.max(ports.inputs.length, ports.outputs.length));
  const layout = $derived(JSON.stringify([data.name, ordinal, ports, versions]));

  $effect(() => {
    layout;
    untrack(() => updateNodeInternals(id));
  });

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
      <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label={branch.label} labelAsName={false} tabindex={-1} tooltipEnabled={hoveredRestore !== branch.id}
        onpointerover={event => hoveredRestore = event.target instanceof Element && event.target.closest(".workflow-restore-branch") ? branch.id : undefined}
        onpointerleave={() => hoveredRestore = undefined}>
        {#snippet child({ props })}
          {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
          <div {...hintProps} class="operation-port">
            <span class="port-label">{#if input}{label}{:else}<span class="port-code">{separator < 0 ? label : label.slice(0, separator)}</span>{separator < 0 ? "" : label.slice(separator)}{/if}</span>
            <span class="port-type">Object</span>
            <Handle id={branch.id} type={input ? "target" : "source"} {position}
              class="owner-port"
              isConnectable={true} isConnectableStart={!input} isConnectableEnd={input}
              aria-disabled={false} aria-label={`${branch.label} ${input ? "input" : "output"}`} />
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

<div class="operation-node workflow-owner-node" class:selected data-operation-name={data.name}>
  {@render portRow("inputs")}
  <div class="operation-title-row">
    <MaterialIcon name="http" size={28} />
    <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label={[...(categoryPath ?? []), data.name].join(" / ")}
      labelAsName={false} tooltipEnabled={Boolean(categoryPath?.length)} tabindex={-1}>
      {#snippet child({ props })}
        {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
        <strong {...hintProps}>{data.name}</strong>
      {/snippet}
    </HintButton>
    {#if ordinal}<span class="instance-pill" aria-label={`Instance ${ordinal}`}>{ordinal}</span>{/if}
  </div>
  {#if versions.length > 1}
    <div class="operation-version">
      <WorkflowNodeSelect label="API version" value={data.operationId} choices={versions}
        active={versionsFor?.active() ?? false} disabled={versionsFor?.pending() ?? false}
        onchange={operationId => { void versionsFor?.select(id, operationId); }} />
    </div>
  {/if}
  <span class="sr-only">{data.method} {data.path}. {data.description}</span>
  {@render portRow("outputs")}
</div>

<style>
  .operation-version { padding: 0 10px 8px; }
</style>
