<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import Handle from "./WorkflowHandle.svelte";
  import { getContext, untrack } from "svelte";
  import { Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { defaultProcessingData, processingDefinition, processingInputTypes, processingOperations, processingOutputType, processingTypeLabel, type ProcessingData, type ProcessingKind } from "$lib/workflow-processing.ts";
  import type { RoutingType } from "$lib/workflow-utilities.ts";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import WorkflowFieldMappings from "./WorkflowFieldMappings.svelte";
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
  const inputLabel = $derived(kind !== "assert" ? definition.inputLabel ?? definition.inputs.join(" | ") : processingTypeLabel(inputType));
  const outputType = $derived(processingTypeLabel(processingOutputType(kind, data, inputType)));
  const keyTypes = $derived(processingInputTypes(kind, data, "key")?.join(" | "));
  const active = $derived(editorActive?.() ?? true);
  const family = $derived(kind[0]!.toUpperCase() + kind.slice(1));
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = $derived(`${data.operation}:${data.parameters.type ?? ""}:${inputLabel}:${outputType}`);
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  function parameter(name: string, value: string) { edit(id, { ...data, parameters: { ...data.parameters, [name]: value } }); }
  const choiceLabel = (value: string) => /^(HS256|RS256|UTF-8)$/.test(value) ? value : value.replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
</script>

<div class="workflow-utility-node workflow-processing-node" class:selected class:jwt-sign={data.operation === "jwt_sign"} data-processing-kind={kind}>
  <div class="utility-title">
    <Handle id="value" type="target" position={Position.Left} isConnectableStart={false}
      tooltip={kind === "assert" ? `Value to check (${inputLabel}). Passed through unchanged on Success or Failure.` : undefined}
      isConnectableEnd={!inputConnected(id, "value")} aria-disabled={inputConnected(id, "value")} aria-label={`${family} input (${inputLabel})`} />
    <MaterialIcon name={kind === "transform" ? "transform" : kind === "filter" ? "filter_alt" : "fact_check"} size={20} />
    <strong>{definition.label}</strong><span class="utility-type">{inputLabel}</span>
  </div>
  {#if kind !== "assert"}
    <div class="utility-row nodrag nopan nokey">
      <WorkflowNodeSelect label={`${family} operation`} tooltip={kind === "transform" ? "Transformation" : "Filter"} value={data.operation} {choices} {active}
        onchange={operation => edit(id, defaultProcessingData(kind, operation))} />
    </div>
  {/if}
  {#if definition.key}
    <div class="utility-row key-input">
      <Handle id="key" type="target" position={Position.Left} isConnectableStart={false}
        isConnectableEnd={!inputConnected(id, "key")} aria-disabled={inputConnected(id, "key")} aria-label={`Signing key input (${keyTypes})`} />
      <span>Signing key</span><span class="utility-type key-type">{keyTypes}</span>
    </div>
  {/if}
  {#if data.operation === "map_fields"}
    <WorkflowFieldMappings {id} value={data.parameters.fields ?? "{}"} {active} onchange={value => parameter("fields", value)} />
  {:else}
  {#each definition.parameters as field (field.name)}
      {@const connected = !!field.connectable && inputConnected(id, field.name)}
      <div class="processing-parameter workflow-node-field nodrag nopan nokey" class:key-id={field.name === "key_id"}>
        <label class="parameter-label">
          <span class="parameter-caption">{field.label}
            {#if field.connectable}<span class="utility-type">{processingInputTypes(kind, data, field.name)?.join(" | ")}</span>{/if}
          </span>
          <span class="parameter-control">
          {#if field.options}
            <WorkflowNodeSelect label={field.label} tooltip={kind === "assert" && field.name === "operator" ? "Assertion condition" : field.label} value={data.parameters[field.name] ?? ""} {active}
              choices={field.options.map(value => ({ value, label: choiceLabel(value) }))} onchange={value => parameter(field.name, value)} />
          {:else if field.multiline}
            <textarea id={`${id}-${field.name}`} class="utility-value nowheel" aria-label={field.label} rows="3" wrap="off" maxlength="16000"
              value={data.parameters[field.name]} oninput={event => parameter(field.name, event.currentTarget.value)}></textarea>
          {:else}
            <input id={`${id}-${field.name}`} class="utility-value" aria-label={field.label} maxlength="4096"
              disabled={connected || field.name === "expected" && ["is_set", "is_not_set"].includes(data.parameters.operator!)}
              inputmode={field.name === "start" || field.name === "end" ? "numeric" : "text"}
              value={data.parameters[field.name]} oninput={event => parameter(field.name, event.currentTarget.value)} />
          {/if}
          </span>
        </label>
        {#if field.connectable}
          <Handle id={field.name} type="target" position={Position.Left} isConnectableStart={false} class="parameter-input-handle"
            isConnectableEnd={!connected} aria-disabled={connected} aria-label={`${field.label} input (${processingInputTypes(kind, data, field.name)?.join(" | ")})`} />
        {/if}
      </div>
  {/each}
  {/if}
  {#if kind === "assert"}
    <div class="utility-row processing-output"><span>Success</span><span class="utility-type output-type">{outputType}</span>
      <Handle tooltip={`Original input when the assertion passes (${outputType})`} id="success" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`Assertion success (${outputType})`} /></div>
    <div class="utility-row processing-output"><span>Failure</span><span class="utility-type output-type">{outputType}</span>
      <Handle tooltip={`Original input when the assertion fails (${outputType})`} id="failure" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`Assertion failure (${outputType})`} /></div>
  {:else}
    <div class="utility-row processing-output"><span>Result</span><span class="utility-type output-type">{outputType}</span>
      <Handle id="result" type="source" position={Position.Right} isConnectableEnd={false} aria-label={`${family} result (${outputType})`} /></div>
  {/if}
</div>

<style>
  .workflow-processing-node { width: 300px; }
  .utility-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .processing-parameter { position: relative; display: grid; min-width: 0; padding: 6px 12px; }
  .parameter-caption { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; color: var(--color-muted-foreground); }
  .parameter-label { display: grid; gap: 5px; min-width: 0; }
  .parameter-control { display: block; min-width: 0; }
  .processing-parameter :global(.parameter-input-handle) { left: 0; top: auto; bottom: 21px; transform: translate(-50%, 50%); }
  .processing-parameter .utility-value { width: 100%; min-height: 30px; padding: 6px 8px; font-size: 11px; }
  textarea.utility-value { height: 76px; resize: vertical; max-height: 180px; }
  .processing-output { min-height: 32px; border-top: 1px solid var(--color-border); font-size: 11px; }
  .output-type { margin-left: auto; }
  .key-type { margin-left: auto; }
  .key-input { min-height: 32px; font-size: 11px; }
  .workflow-processing-node .key-input { border-top: 0; border-bottom: 1px solid var(--color-border); }
  .workflow-processing-node .key-input ~ .processing-output { border-top: 0; }
  .workflow-processing-node .utility-row:not(.key-input) + .processing-parameter { border-top: 1px solid var(--color-border); }
  .workflow-processing-node:not([data-processing-kind="assert"]) .processing-parameter ~ .processing-output { border-top: 0; }
  .workflow-processing-node.jwt-sign .key-input { border-bottom: 0; }
  .key-id { border-bottom: 1px solid var(--color-border); }
</style>
