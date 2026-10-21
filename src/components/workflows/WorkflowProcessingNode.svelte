<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { defaultProcessingData, processingDefinition, processingOperations, processingOutputType, processingTypeLabel, type ProcessingData, type ProcessingKind } from "$lib/workflow-processing.ts";
  import type { RoutingType } from "$lib/workflow-utilities.ts";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import "./workflow-utility-nodes.css";

  let { id, type, data, selected }: NodeProps<Node<ProcessingData, ProcessingKind>> = $props();
  const edit = getContext<(id: string, data: ProcessingData) => void>("workflow-processing");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const inputConnected = getContext<(id: string, handle?: string) => boolean>("workflow-input-connected");
  const inputTypeFor = getContext<(id: string) => RoutingType>("workflow-input-type");
  const kind = $derived(type as ProcessingKind);
  const definition = $derived(processingDefinition(kind, data));
  const choices = $derived(processingOperations.filter(operation => operation.kind === kind).map(operation => ({ value: operation.id, label: operation.label })));
  const inputType = $derived(inputTypeFor(id));
  const inputLabel = $derived(kind === "transform" ? definition.inputLabel ?? definition.inputs.join(" | ") : processingTypeLabel(inputType));
  const outputType = $derived(processingTypeLabel(processingOutputType(kind, data, inputType)));
  const active = $derived(editorActive?.() ?? true);
  const family = $derived(kind[0]!.toUpperCase() + kind.slice(1));
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = $derived(`${data.operation}:${data.parameters.type ?? ""}:${inputLabel}:${outputType}`);
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  function parameter(name: string, value: string) { edit(id, { ...data, parameters: { ...data.parameters, [name]: value } }); }
  const choiceLabel = (value: string) => /^(HS256|RS256|UTF-8)$/.test(value) ? value : value.replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
</script>

<div class="workflow-utility-node workflow-processing-node" class:selected data-processing-kind={kind}>
  <div class="utility-title">
    <Handle id="value" type="target" position={Position.Left} isConnectableStart={false}
      isConnectableEnd={!inputConnected(id, "value")} aria-disabled={inputConnected(id, "value")} aria-label={`${family} input (${inputLabel})`} />
    <MaterialIcon name={kind === "transform" ? "transform" : kind === "filter" ? "filter_alt" : "fact_check"} size={20} />
    <strong title={`${family}: ${definition.label}`}>{definition.label}</strong><span class="utility-type">{inputLabel}</span>
  </div>
  {#if kind !== "assert"}
    <div class="utility-row nodrag nopan nokey">
      <WorkflowNodeSelect label={`${family} operation`} value={data.operation} {choices} {active}
        onchange={operation => edit(id, defaultProcessingData(kind, operation))} />
    </div>
  {/if}
  {#if definition.key}
    <div class="utility-row key-input">
      <Handle id="key" type="target" position={Position.Left} isConnectableStart={false}
        isConnectableEnd={!inputConnected(id, "key")} aria-disabled={inputConnected(id, "key")} aria-label="Signing key input" />
      <span>Signing key</span><span class="key-state">{inputConnected(id, "key") ? "Connected" : "Connect a key"}</span>
    </div>
  {/if}
  {#each definition.parameters as field (field.name)}
      <div class="processing-parameter nodrag nopan nokey">
        <label for={`${id}-${field.name}`}>{field.label}</label>
        {#if field.options}
          <WorkflowNodeSelect label={field.label} value={data.parameters[field.name] ?? ""} {active}
            choices={field.options.map(value => ({ value, label: choiceLabel(value) }))} onchange={value => parameter(field.name, value)} />
        {:else if field.multiline}
          <textarea id={`${id}-${field.name}`} class="utility-value nowheel" aria-label={field.label} rows="3" wrap="off" maxlength="16000"
            value={data.parameters[field.name]} oninput={event => parameter(field.name, event.currentTarget.value)}></textarea>
        {:else}
          <input id={`${id}-${field.name}`} class="utility-value" aria-label={field.label} maxlength="4096"
            disabled={field.name === "expected" && ["is_set", "is_not_set"].includes(data.parameters.operator!)}
            inputmode={field.name === "start" || field.name === "end" ? "numeric" : "text"}
            value={data.parameters[field.name]} oninput={event => parameter(field.name, event.currentTarget.value)} />
        {/if}
      </div>
  {/each}
  {#if kind === "assert"}
    <div class="utility-row processing-output"><span>Success</span>
      <Handle id="success" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`Assertion success (${outputType})`} /></div>
    <div class="utility-row processing-output"><span>Failure</span>
      <Handle id="failure" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`Assertion failure (${outputType})`} /></div>
  {:else}
    <div class="utility-row processing-output"><span>Result</span><span class="utility-type output-type">{outputType}</span>
      <Handle id="result" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`${family} result (${outputType})`} /></div>
  {/if}
</div>

<style>
  .workflow-processing-node { width: 300px; }
  .utility-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .processing-parameter { display: grid; gap: 5px; min-width: 0; padding: 6px 12px; }
  .processing-parameter label { font-size: 10px; color: var(--color-muted-foreground); }
  .processing-parameter .utility-value { width: 100%; min-height: 30px; padding: 6px 8px; font-size: 11px; }
  textarea.utility-value { height: 76px; resize: vertical; max-height: 180px; }
  .processing-output { min-height: 32px; border-top: 1px solid var(--color-border); font-size: 11px; }
  .output-type { margin-left: auto; }
  .key-state { margin-left: auto; color: var(--color-muted-foreground); font-size: 10px; }
  .key-input { min-height: 32px; font-size: 11px; }
</style>
