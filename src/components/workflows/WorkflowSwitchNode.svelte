<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { Handle, Position, useNodeConnections, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import FieldNumber from "$lib/components/FieldNumber.svelte";
  import type { SwitchData, SwitchGate } from "$lib/workflow-document.ts";
  import { operatorsForType, switchGateInput, switchGateLimit, switchValueLimit, type RoutingType } from "$lib/workflow-utilities.ts";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import "./workflow-utility-nodes.css";

  let { id, data, selected }: NodeProps<Node<SwitchData, "switch">> = $props();
  const gates = getContext<{ add: (id: string) => void; remove: (id: string, gateId: string) => void;
    edit: (id: string, gateId: string, patch: Partial<Pick<SwitchGate, "operator" | "value">>) => void }>("workflow-switch-gates");
  const inputTypeFor = getContext<(id: string) => RoutingType>("workflow-input-type");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const inputType = $derived(inputTypeFor(id));
  const operators = $derived(operatorsForType(inputType));
  const active = $derived(editorActive?.() ?? true);
  const connections = useNodeConnections({ handleType: "target" });
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = $derived(JSON.stringify([inputType, data.gates.map(gate => gate.id)]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
</script>

<div class="workflow-utility-node workflow-switch-node" class:selected>
  <div class="utility-title">
    <Handle id="value" type="target" position={Position.Left} isConnectableStart={false} aria-label={`Switch input (${inputType})`} />
    <MaterialIcon name="call_split" size={20} /><strong>Switch</strong><span class="utility-type">{inputType}</span>
  </div>
  {#each data.gates as gate, index (gate.id)}
    {@const operator = operators.find(choice => choice.value === gate.operator) ?? operators[0]}
    {@const connected = connections.current.some(connection => connection.targetHandle === switchGateInput(gate.id))}
    <div class="utility-row switch-gate nodrag nopan nokey" data-gate-id={gate.id}>
      <Handle id={switchGateInput(gate.id)} type="target" position={Position.Left} isConnectableStart={false}
        isConnectableEnd={!connected} aria-label={`Gate ${index + 1} value input`} />
      <HintButton type="button" class="utility-action" label={`Remove gate ${index + 1}`} disabled={data.gates.length === 1}
        onclick={() => gates.remove(id, gate.id)}><MaterialIcon name="cancel" size={18} /></HintButton>
      <div class="gate-operator">
        <WorkflowNodeSelect label={`Gate ${index + 1} operator`} value={gate.operator} choices={operators} {active}
          onchange={operator => gates.edit(id, gate.id, { operator: operator as SwitchGate["operator"] })} />
      </div>
      <div class="gate-value nowheel">
        {#if connected || operator?.unary}
          <input class="utility-value" aria-label={`Gate ${index + 1} value`} value={connected ? "Connected" : "No value needed"} disabled />
        {:else if inputType === "Boolean"}
          <WorkflowNodeSelect label={`Gate ${index + 1} value`} value={gate.value} choices={[{ value: "true", label: "true" }, { value: "false", label: "false" }]} {active}
            onchange={value => gates.edit(id, gate.id, { value })} />
        {:else if inputType === "Number"}
          <div class="joined-field number-operand">
            <FieldNumber id={`${id}-${gate.id}-value`} label={`Gate ${index + 1} value`} value={gate.value}
              onValueChange={value => gates.edit(id, gate.id, { value })} />
          </div>
        {:else}
          <textarea class="utility-value" aria-label={`Gate ${index + 1} value`} placeholder="Value" rows="1" wrap="off"
            maxlength={switchValueLimit} value={gate.value} oninput={event => gates.edit(id, gate.id, { value: event.currentTarget.value })}></textarea>
        {/if}
      </div>
      <Handle id={gate.id} type="source" position={Position.Right} isConnectableEnd={false} aria-label={`Gate ${index + 1} output`} />
    </div>
  {/each}
  <div class="switch-actions nodrag nopan nokey">
    <HintButton type="button" class="utility-action add-gate" label="Add gate" disabled={data.gates.length >= switchGateLimit}
      onclick={() => gates.add(id)}><MaterialIcon name="add" size={18} /><span>Add gate</span></HintButton>
  </div>
</div>

<style>
  .workflow-switch-node { width: 300px; }
  .gate-operator { flex: 0 0 64px; }
  .gate-value { min-width: 0; flex: 1; }
  textarea.utility-value { display: block; height: 30px; resize: vertical; max-height: 160px; }
  .number-operand { display: block; min-height: 30px; --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .number-operand :global(input.field-input) { min-height: 30px; padding: 6px 28px 6px 8px; font-size: 11px; }
  .number-operand :global(.field-number-steppers) { width: 24px; }
  .number-operand :global(.field-number-steppers button) { min-height: 15px; }
  .switch-actions { display: flex; justify-content: center; padding: 7px 12px; border-top: 1px solid var(--color-border); }
  .switch-actions :global(.add-gate) { display: flex; justify-content: center; gap: 5px; width: 100%; font-size: 11px; }
</style>
