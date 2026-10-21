<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { useUpdateNodeInternals } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { fieldMappingLimit, readFieldMappings, writeFieldMappings } from "$lib/workflow-field-mappings.ts";
  import WorkflowNodeSelect from "./WorkflowNodeSelect.svelte";

  let { id, value, active, onchange }: { id: string; value: string; active: boolean; onchange: (value: string) => void } = $props();
  const saved = $derived.by(() => {
    try { return { mappings: readFieldMappings(value), error: "" }; }
    catch (error) { return { mappings: [], error: error instanceof Error ? error.message : String(error) }; }
  });
  let open = $state(false);
  let editing = $state<number | null>(null);
  let name = $state("");
  let path = $state<string[]>([]);
  let error = $state("");
  let nameInput = $state<HTMLInputElement>();
  let addButton = $state<HTMLButtonElement | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = $derived(JSON.stringify([value, open, path.length, error]));
  $effect(() => { layout; untrack(() => updateNodeInternals(id)); });
  // Undo/import can replace the saved value while a draft is open.
  $effect(() => { value; untrack(() => { open = false; error = ""; }); });
  const sourceLabel = (path: string[]) => path.length ? path.map(part => part || "(empty name)").join(" › ") : "Entire input";

  async function edit(index: number | null) {
    const mapping = index === null ? undefined : saved.mappings[index];
    editing = index;
    name = mapping?.name ?? "";
    path = mapping ? [...mapping.path] : [""];
    error = "";
    open = true;
    await tick();
    nameInput?.focus({ preventScroll: true });
  }

  async function close() {
    const index = editing;
    // Release text-edit tracking before Svelte removes the focused form input.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && nameInput?.form?.contains(focused)) focused.blur();
    open = false;
    error = "";
    await tick();
    (index === null ? addButton : document.getElementById(`${id}-mapping-${index}`))?.focus({ preventScroll: true });
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (!active) return;
    if (!name.trim()) { error = "Enter a name for the new field."; return; }
    const mappings = [...saved.mappings];
    const mapping = { name, path: [...path] };
    if (editing === null) mappings.push(mapping); else mappings[editing] = mapping;
    try { onchange(writeFieldMappings(mappings)); void close(); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  }

  function remove(index: number) {
    if (active) onchange(writeFieldMappings(saved.mappings.filter((_, current) => current !== index)));
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void close(); }
  }
</script>

<div class="field-mappings nodrag nopan nokey nowheel">
  <p class="mapping-help">Copy fields into a new object. Only the fields listed below are kept.</p>
  {#if saved.error}
    <p class="mapping-error" role="alert">{saved.error}</p>
    <button type="button" class="mapping-button" disabled={!active} onclick={() => onchange("{}")}>Reset mappings</button>
  {:else}
    {#if saved.mappings.length}
      <div class="mapping-headings" aria-hidden="true"><span>Copy from</span><span>New field name</span></div>
      <ul class="mapping-list" aria-label="Field mappings">
        {#each saved.mappings as mapping, index (mapping.name)}
          <li>
            <button id={`${id}-mapping-${index}`} type="button" class="mapping-summary" disabled={!active || open}
              aria-label={`Edit mapping ${mapping.name || "(empty name)"}`} onclick={() => edit(index)}>
              <span title={sourceLabel(mapping.path)}>{sourceLabel(mapping.path)}</span>
              <MaterialIcon name="arrow_forward" size={14} />
              <strong title={mapping.name}>{mapping.name || "(empty name)"}</strong>
              <MaterialIcon name="edit" size={16} />
            </button>
            <HintButton type="button" class="utility-action" label={`Remove mapping ${mapping.name || "(empty name)"}`} disabled={!active || open}
              tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" onclick={() => remove(index)}><MaterialIcon name="delete" size={16} /></HintButton>
          </li>
        {/each}
      </ul>
    {:else}<p class="mapping-help">No fields yet. Add a mapping to choose what goes in the result.</p>{/if}
    {#if open}
      <form class="mapping-editor" aria-label={editing === null ? "Add field mapping" : "Edit field mapping"} onsubmit={save}>
        <label for={`${id}-mapping-name`}>New field name</label>
        <input id={`${id}-mapping-name`} class="utility-value" bind:this={nameInput} bind:value={name} disabled={!active} maxlength="4096"
          placeholder="e.g. Customer name" onkeydown={cancelOnEscape} aria-invalid={!!error} aria-describedby={error ? `${id}-mapping-error` : undefined} />
        <span class="mapping-label">Copy from</span>
        <WorkflowNodeSelect label="Copy from" value={path.length ? "field" : "input"} {active} disabled={!active}
          choices={[{ value: "input", label: "Entire input" }, { value: "field", label: "A field or array item" }]}
          onchange={source => path = source === "input" ? [] : [""]} />
        {#if path.length}
          <div class="mapping-path nowheel">
            {#each path as part, index (index)}
              <div class="path-level">
                <label for={`${id}-mapping-path-${index}`}>{index === 0 ? "Source field" : "Inside that field"}</label>
                <input id={`${id}-mapping-path-${index}`} class="utility-value" aria-label={`Source field ${index + 1}`} disabled={!active}
                  maxlength="4096" value={part} placeholder={index === 0 ? "e.g. profile" : "e.g. name"} onkeydown={cancelOnEscape}
                  oninput={event => path[index] = event.currentTarget.value} />
                <HintButton type="button" class="utility-action" label={`Remove source level ${index + 1}`} disabled={!active}
                  tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" onclick={() => path = path.filter((_, current) => current !== index)}><MaterialIcon name="close" size={16} /></HintButton>
              </div>
            {/each}
          </div>
          <button type="button" class="mapping-button" disabled={!active || path.length >= 64} onclick={() => path = [...path, ""]}>
            <MaterialIcon name="add" size={16} />Add nested field
          </button>
          <p class="mapping-help">Use one field name per level. For array items, use 0 for the first item, 1 for the second.</p>
        {/if}
        <div class="mapping-actions">
          <button type="submit" class="mapping-button" disabled={!active}><MaterialIcon name="check" size={16} />Save mapping</button>
          <button type="button" class="mapping-button" onclick={close}><MaterialIcon name="backspace" size={16} />Cancel</button>
        </div>
        {#if error}<p id={`${id}-mapping-error`} class="mapping-error" role="alert">{error}</p>{/if}
      </form>
    {/if}
    <button type="button" class="mapping-button add-mapping" bind:this={addButton} disabled={!active || open || saved.mappings.length >= fieldMappingLimit}
      onclick={() => edit(null)}><MaterialIcon name="add" size={16} />Add mapping</button>
  {/if}
</div>

<style>
  .field-mappings { display: grid; gap: 8px; min-width: 0; padding: 6px 12px 10px; font-size: 11px; }
  .mapping-help { margin: 0; color: var(--color-muted-foreground); font-size: 10px; }
  .mapping-headings { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-right: 50px; color: var(--color-muted-foreground); font-size: 10px; }
  .mapping-list { display: grid; gap: 4px; max-height: 210px; margin: 0; padding: 0; list-style: none; overflow: auto; overscroll-behavior: contain; }
  .mapping-list li { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .mapping-summary { display: grid; grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr) 16px; align-items: center; gap: 5px; min-width: 0; flex: 1; min-height: 30px; padding: 6px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); text-align: left; }
  .mapping-summary span, .mapping-summary strong { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mapping-summary:hover:not(:disabled), .mapping-button:hover:not(:disabled) { background: var(--color-secondary-hover); color: var(--color-secondary-hover-foreground); }
  .mapping-summary:disabled, .mapping-button:disabled { color: var(--color-disabled-foreground); cursor: not-allowed; }
  .mapping-editor { display: grid; gap: 5px; min-width: 0; padding-top: 8px; border-top: 1px solid var(--color-border); }
  .mapping-editor label, .mapping-label { color: var(--color-muted-foreground); font-size: 10px; }
  .mapping-path { display: grid; gap: 5px; max-height: 200px; overflow: auto; overscroll-behavior: contain; }
  .path-level { display: grid; grid-template-columns: minmax(0, 1fr) 26px; gap: 4px; padding-left: 8px; border-left: 1px solid var(--color-border); }
  .path-level label { grid-column: 1 / -1; }
  .mapping-button { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 28px; padding: 5px 7px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font: inherit; }
  .mapping-actions { display: flex; gap: 5px; margin-top: 4px; }
  .mapping-error { margin: 0; color: var(--color-error-foreground); overflow-wrap: anywhere; }
</style>
