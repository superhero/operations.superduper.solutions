<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { getContext, tick, untrack } from "svelte";
  import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import type { WorkflowData, WorkflowField } from "$lib/workflow-document.ts";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";
  import WorkflowRestoreBranch from "./WorkflowRestoreBranch.svelte";

  type Branch = { id: string; childId: string; direction: "inputs" | "outputs"; label: string; hidden: boolean };
  type EditableProperty = { fieldId: string; name: string; types: WorkflowField["type"][] };
  let { id, data, selected }: NodeProps<Node<WorkflowData, "data">> = $props();
  const branchesFor = getContext<((id: string) => Map<string, Branch> | undefined) | undefined>("workflow-branches");
  const properties = getContext<{ types: (id: string) => WorkflowField["type"][];
    editable: (id: string) => EditableProperty[];
    add: (id: string, name: string, type: WorkflowField["type"]) => void;
    edit: (id: string, fieldId: string, name: string, type: WorkflowField["type"]) => void;
    remove: (id: string, fieldId: string) => void } | undefined>("workflow-add-property");
  const editorActive = getContext<(() => boolean) | undefined>("workflow-editor-active");
  const inputConnected = getContext<((id: string, handleId?: string | null) => boolean) | undefined>("workflow-input-connected");
  const active = $derived(editorActive?.() ?? true);
  const propertyTypes = $derived.by(() => {
    data;
    // Property policy changes with node data, not every canvas drag or selection.
    return untrack(() => properties?.types(id) ?? []);
  });
  const editableProperties = $derived.by(() => {
    data;
    return new Map(untrack(() => properties?.editable(id) ?? []).map(property => [property.fieldId, property]));
  });
  let editMode = $state(false);
  let adding = $state(false);
  let editing = $state<string | null>(null);
  const choices = $derived(editing ? editableProperties.get(editing)?.types ?? [] : propertyTypes);
  let propertyName = $state("");
  let propertyType = $state<WorkflowField["type"]>("Text");
  let propertyError = $state("");
  let nameInput = $state<HTMLInputElement>();
  let propertiesButton = $state<HTMLButtonElement | null>(null);
  let hoveredFieldDetail = $state<string>();
  const updateNodeInternals = useUpdateNodeInternals();
  const input = $derived(data.direction === "inputs");
  const panelLabel = $derived(data.label === "File data" && data.array ? "Array" : data.label === "Items" ? "Item" : data.label);
  const noFields = $derived(!data.fields.length);
  // Older saved panels lost this notice on their first custom field.
  const noNamedProperties = $derived(data.notice === "No named properties documented"
    || !data.notice && data.fields.length > 0 && editableProperties.size === data.fields.length);
  const notice = $derived(data.notice || (noNamedProperties ? "No named properties documented" : ""));
  const branches = $derived(branchesFor?.(id));
  const layout = $derived(JSON.stringify([data, editMode, adding, editing, propertyError, [...(branches?.values() ?? [])]]));

  $effect(() => {
    layout;
    untrack(() => updateNodeInternals(id));
  });

  function blockPointer(event: MouseEvent | TouchEvent) { event.stopPropagation(); }

  async function openProperty(fieldId?: string) {
    const property = fieldId ? editableProperties.get(fieldId) : undefined;
    editing = property?.fieldId ?? null;
    propertyName = property?.name ?? "";
    propertyType = data.fields.find(field => field.id === editing)?.type ?? propertyTypes[0] ?? "Text";
    propertyError = "";
    adding = true;
    await tick();
    nameInput?.focus({ preventScroll: true });
  }

  async function closeProperty() {
    adding = false;
    editing = null;
    propertyError = "";
    await tick();
    propertiesButton?.focus({ preventScroll: true });
  }

  function finishEditing() {
    editMode = false;
    void closeProperty();
  }

  function saveProperty(event: SubmitEvent) {
    event.preventDefault();
    try {
      if (editing) properties?.edit(id, editing, propertyName, propertyType);
      else properties?.add(id, propertyName, propertyType);
      void closeProperty();
    } catch (error) { propertyError = error instanceof Error ? error.message : String(error); }
  }

  function removeProperty() {
    if (!editing) return;
    try {
      properties?.remove(id, editing);
      void closeProperty();
    } catch (error) { propertyError = error instanceof Error ? error.message : String(error); }
  }
</script>

{#snippet title()}
  <div class="data-title">
    <Handle id="value" type={input ? "source" : "target"} position={input ? Position.Right : Position.Left}
      class="structural-port" isConnectable={!input} isConnectableStart={false} isConnectableEnd={!input}
      {...(input ? { onmousedown: blockPointer, ontouchstart: blockPointer } : {})} aria-disabled={input} aria-label={`${panelLabel} ${data.array ? "array" : "object"}`} />
    <MaterialIcon name={data.array ? "data_array" : "data_object"} size={20} />
    <strong data-label={panelLabel}>{input ? panelLabel.replace(/ parameters$/i, "") : panelLabel.replace(/^Response · .+$/, "Response")}</strong>
  </div>
{/snippet}

{#snippet fieldContent(field: WorkflowField)}
  <span class="field-name">{data.array ? `${data.array.min}..${data.array.max ?? "*"}` : field.label}{#if field.required && !data.array}<HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label="Required" labelAsName={false}>
      {#snippet child({ props })}
        {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
        <abbr {...hintProps} class="required" aria-label="Required"> *</abbr>
      {/snippet}
    </HintButton>{/if}</span>
  <span class="field-type">{field.itemType ?? field.type}</span>
{/snippet}

<div class="workflow-data-node" class:selected data-owner-id={data.ownerId} data-direction={data.direction}>
  {#if !input}{@render title()}{/if}
  {#if data.fields.length}
    <div class="data-fields">
      {#each data.fields as field (field.id)}
        {@const branch = branches?.get(field.id)}
        {@const position = input ? Position.Left : Position.Right}
        {@const editable = editableProperties.get(field.id)}
        {@const connected = input && (inputConnected?.(id, field.id) ?? false)}
        {@const hint = [field.description, field.required ? "Required" : ""].filter(Boolean).join("\n")}
        <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label={hint} labelAsName={false} tooltipEnabled={Boolean(hint) && hoveredFieldDetail !== field.id}
          onpointerover={event => hoveredFieldDetail = event.target instanceof Element && event.target.closest(".required, .workflow-restore-branch") ? field.id : undefined}
          onpointerleave={() => hoveredFieldDetail = undefined}>
          {#snippet child({ props })}
            {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
            <div {...hintProps} class="data-field" class:deferred={!field.connectable} data-field-id={field.id}>
              {#if field.connectable || branch}
                <Handle id={field.id} type={input ? "target" : "source"} {position}
                  isConnectable={field.connectable} isConnectableStart={field.connectable && !input}
                  isConnectableEnd={field.connectable && input && !connected} aria-disabled={!field.connectable || connected}
                  aria-label={`${field.label} ${input ? "input" : "output"}`} />
              {/if}
              {#if branch?.hidden}
                <WorkflowRestoreBranch {branch} {position} beside={!input && field.connectable} />
              {/if}
              {#if editMode && editable}
                <button type="button" class="editable-field nodrag nopan nokey" aria-label={`Edit property ${editable.name}`}
                  aria-pressed={editing === field.id} disabled={!active} onclick={() => openProperty(field.id)}>
                  {@render fieldContent(field)}
                </button>
              {:else}
                {@render fieldContent(field)}
              {/if}
            </div>
          {/snippet}
        </HintButton>
      {/each}
    </div>
  {/if}
  {#if notice || noFields}
    <div class="data-notice" class:no-fields={noFields || noNamedProperties}>{#if !noFields && !noNamedProperties}<MaterialIcon name="info" size={16} />{/if}<span class="notice-text">{notice || "No named fields documented."}</span></div>
  {/if}
  {#if propertyTypes.length || editableProperties.size || editMode}
    <div class="property-actions nodrag nopan nokey nowheel">
      {#if adding}
        <form class="property-editor" class:editing={!!editing} onsubmit={saveProperty}>
          <input class="property-name" aria-label="Property name" placeholder="Property name" maxlength={200}
            bind:value={propertyName} bind:this={nameInput} disabled={!active} required aria-invalid={!!propertyError}
            onkeydown={event => {
              if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); void closeProperty(); }
            }} />
          <WorkflowNodeSelect label="Property type" value={propertyType} choices={choices.map(type => ({ value: type, label: type }))}
            {active} disabled={!active || choices.length === 1} onchange={type => propertyType = type as WorkflowField["type"]} />
          <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="submit" class="property-action" label={editing ? "Save property" : "Add property"} disabled={!active || !propertyName.trim()}><MaterialIcon name={editing ? "save" : "check"} size={18} /></HintButton>
          {#if editing}
            <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="button" class="property-action" label="Remove property" disabled={!active} onclick={removeProperty}><MaterialIcon name="delete" size={18} /></HintButton>
          {/if}
          <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="button" class="property-action" label={editing ? "Cancel editing property" : "Cancel adding property"} onclick={closeProperty}><MaterialIcon name="close" size={18} /></HintButton>
          {#if propertyError}<span class="property-error" role="alert">{propertyError}</span>{/if}
        </form>
      {/if}
      <div class="property-controls">
        {#if editMode}
          <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="button" class="property-action properties-mode" label="Add field" bind:ref={propertiesButton}
            disabled={!active || !propertyTypes.length || data.fields.length >= 200 || (adding && !editing)}
            onclick={() => openProperty()}><MaterialIcon name="add" size={18} /><span>Add field</span></HintButton>
          <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="button" class="property-action" label="Done editing properties" onclick={finishEditing}><MaterialIcon name="check" size={18} /></HintButton>
        {:else}
          <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" type="button" class="property-action properties-mode" label="Edit properties" tooltipEnabled={false} bind:ref={propertiesButton}
            disabled={!active} onclick={() => editMode = true}><MaterialIcon name="edit" size={18} /><span>Edit properties</span></HintButton>
        {/if}
      </div>
    </div>
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
  .editable-field { display: flex; align-items: center; flex: 1; gap: 10px; min-width: 0; margin: 0; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .editable-field:hover, .editable-field[aria-pressed="true"] { color: var(--color-emphasis); }
  .editable-field:focus-visible { outline: 2px solid var(--color-emphasis); outline-offset: 3px; }
  .editable-field:disabled { color: var(--color-muted-foreground); cursor: default; }
  .deferred .field-type { background: var(--color-background); color: var(--color-muted-foreground); }
  .data-notice { display: flex; align-items: flex-start; gap: 7px; padding: 10px 12px; border-top: 1px solid var(--color-border); color: var(--color-muted-foreground); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
  .data-notice.no-fields { color: var(--color-badge-background); }
  .no-fields .notice-text { font-style: italic; }
  .property-actions { display: grid; gap: 7px; padding: 7px 12px; border-top: 1px solid var(--color-border); }
  .property-actions:first-child { border-top: 0; }
  .property-controls { display: flex; align-items: center; gap: 8px; }
  .property-editor { display: grid; grid-template-columns: minmax(110px, 1fr) 90px 26px 26px; gap: 6px; align-items: center; }
  .property-editor.editing { grid-template-columns: minmax(110px, 1fr) 90px repeat(3, 26px); }
  .property-name { min-width: 0; width: 100%; min-height: 30px; padding: 5px 8px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 11px; }
  .property-name::placeholder { color: var(--color-muted-foreground); }
  .property-actions :global(.property-action) { display: flex; align-items: center; justify-content: center; min-height: 26px; padding: 0; border: 0; border-radius: 4px; outline-offset: 6px; background: transparent; color: var(--color-foreground); font-size: 11px; }
  .property-actions :global(.property-action:disabled) { color: var(--color-muted-foreground); }
  .property-actions :global(.properties-mode) { flex: 1; gap: 5px; }
  .property-controls :global(.property-action) { position: relative; outline: none; }
  .property-controls :global(.property-action::after) { content: ""; position: absolute; inset: -6px -12px; border-radius: inherit; outline: 3px solid transparent; outline-offset: 0; pointer-events: none; transition: outline-color 180ms ease-in; }
  .property-controls :global(.property-action:focus-visible::after) { outline-color: var(--color-ring); }
  .property-error { grid-column: 1 / -1; max-width: 300px; color: var(--color-badge-background); font-size: 11px; overflow-wrap: anywhere; }
  .workflow-data-node :global(.svelte-flow__handle) { width: 12px; height: 12px; border: 2px solid var(--color-surface); background: var(--color-emphasis); }
  .workflow-data-node :global(.svelte-flow__handle.target) { background: var(--color-foreground); }
  .workflow-data-node :global(.structural-port) { pointer-events: auto; }
  .workflow-data-node :global(.structural-port:not(.connectionindicator)) { cursor: default; }
  @media (prefers-reduced-motion: reduce) { .workflow-data-node { transition: none; } }
</style>
