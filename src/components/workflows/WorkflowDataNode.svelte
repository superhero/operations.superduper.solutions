<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { WorkflowData } from "$lib/workflow-document.ts";
  import WorkflowRestoreBranch from "./WorkflowRestoreBranch.svelte";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  let { id, data, selected }: NodeProps<Node<WorkflowData, "data">> = $props();
  const branchesFor = getContext<((id: string) => Map<string, Branch> | undefined) | undefined>("workflow-branches");
  const updateNodeInternals = useUpdateNodeInternals();
  const input = $derived(data.direction === "inputs");
  const noInputs = $derived(input && !data.fields.length);
  const branches = $derived(branchesFor?.(id));
  const layout = $derived(JSON.stringify([data, [...(branches?.values() ?? [])]]));

  $effect(() => {
    layout;
    untrack(() => updateNodeInternals(id));
  });

  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }
</script>

{#snippet title()}
  <div class="data-title">
    <Handle id="value" type={input ? "source" : "target"} position={input ? Position.Right : Position.Left}
      class="structural-port" isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
      onmousedown={blockPointer} ontouchstart={blockPointer} aria-disabled="true" aria-label={`${data.label} object`} />
    <MaterialIcon name="data_object" size={20} />
    <strong title={data.label}>{input ? data.label.replace(/ parameters$/i, "") : data.label.replace(/^Response · .+$/, "Response")}</strong>
  </div>
{/snippet}

<div class="workflow-data-node" class:selected data-owner-id={data.ownerId} data-direction={data.direction}>
  {#if !input}{@render title()}{/if}
  {#if data.fields.length}
    <div class="data-fields">
      {#each data.fields as field (field.id)}
        {@const branch = branches?.get(field.id)}
        {@const position = input ? Position.Left : Position.Right}
        <div class="data-field" class:deferred={!field.connectable} data-field-id={field.id}
          title={[field.description, field.required ? "Required" : ""].filter(Boolean).join("\n")}>
          {#if field.connectable || branch}
            <Handle id={field.id} type={input ? "target" : "source"} {position}
              style={branch?.hidden && (input || !field.connectable) ? "visibility: hidden" : undefined}
              isConnectable={field.connectable} isConnectableStart={field.connectable && !input}
              isConnectableEnd={field.connectable && input} aria-disabled={!field.connectable}
              aria-label={`${field.label} ${input ? "input" : "output"}`} />
          {/if}
          {#if branch?.hidden}
            <WorkflowRestoreBranch {branch} {position} beside={!input && field.connectable} />
          {/if}
          <span class="field-name">{field.label}{#if field.required}<abbr class="required" title="Required"> *</abbr>{/if}</span>
          <span class="field-type">{field.type}</span>
        </div>
      {/each}
    </div>
  {/if}
  {#if data.notice || !data.fields.length}
    <div class="data-notice" class:no-input={noInputs}>{#if !noInputs}<MaterialIcon name="info" size={16} />{/if}<span class="notice-text">{data.notice || "No named fields documented."}</span></div>
  {/if}
  {#if input}{@render title()}{/if}
</div>

<style>
  .workflow-data-node { width: max-content; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); transition: border-color 180ms ease-in, box-shadow 180ms ease-in; }
  .workflow-data-node:hover:not(.selected) { border-color: var(--color-foreground); }
  .workflow-data-node.selected, :global(.svelte-flow__node:focus-visible) .workflow-data-node { border-color: var(--color-emphasis); box-shadow: 0 0 0 1px var(--color-emphasis); }
  .data-title { position: relative; display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 8px 12px; }
  .data-title strong { min-width: 0; flex: 1; font-size: 12px; font-weight: 650; overflow-wrap: anywhere; }
  [data-direction="inputs"] .data-title { border-top: 1px solid var(--color-border); }
  [data-direction="inputs"] .data-field:first-child, [data-direction="inputs"] > .data-notice:first-child { border-top: 0; }
  .workflow-data-node :global(.material-symbols-rounded) { font-variation-settings: "FILL" 1; }
  .data-field { position: relative; display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 6px 14px; border-top: 1px solid var(--color-border); font-size: 11px; }
  .field-name { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .required { color: var(--color-foreground); font-weight: 700; text-decoration: none; }
  .field-type { flex-shrink: 0; padding: 0 5px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-badge-foreground); font-size: 10px; line-height: 18px; }
  .deferred .field-type { background: var(--color-background); color: var(--color-muted-foreground); }
  .data-notice { display: flex; align-items: flex-start; gap: 7px; padding: 10px 12px; border-top: 1px solid var(--color-border); color: var(--color-muted-foreground); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
  .data-notice.no-input { color: var(--color-badge-background); }
  .no-input .notice-text { font-style: italic; }
  .workflow-data-node :global(.svelte-flow__handle) { width: 12px; height: 12px; border: 2px solid var(--color-surface); background: var(--color-emphasis); }
  .workflow-data-node :global(.svelte-flow__handle.target) { background: var(--color-foreground); }
  .workflow-data-node :global(.structural-port) { pointer-events: auto; cursor: default; }
  @media (prefers-reduced-motion: reduce) { .workflow-data-node { transition: none; } }
</style>
