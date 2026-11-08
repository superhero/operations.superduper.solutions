<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { encodeWorkflowBinary, maxWorkflowUploadBytes, validateWorkflowBinary } from "../workflow-binary.ts";
  let { id, label, value, onValueChange, disabled, active, invalid, describedBy, multiple = false, minItems, maxItems }:
    { id: string; label: string; value: string; onValueChange: (value: string) => void;
      disabled: boolean; active: boolean; invalid: boolean; describedBy?: string | undefined;
      multiple?: boolean; minItems?: number | undefined; maxItems?: number | undefined } = $props();
  let error = $state("");
  let generation = 0;
  onDestroy(() => generation++);
  $effect(() => { if (!active || disabled) generation++; });
  const name = $derived.by(() => { try {
    const parsed = JSON.parse(value);
    if (!multiple) return validateWorkflowBinary(parsed).name;
    return Array.isArray(parsed) ? parsed.map(file => validateWorkflowBinary(file).name).join(", ") : "";
  } catch { return ""; } });
  async function upload(files: File[]) {
    const current = ++generation;
    error = "";
    try {
      if (multiple && (minItems !== undefined && files.length < minItems || maxItems !== undefined && files.length > maxItems))
        throw new Error("The number of selected files is outside the allowed range.");
      if (files.some(file => file.size > maxWorkflowUploadBytes)) throw new Error("Each file must be no larger than 500 kB.");
      const binaries = [];
      for (const file of files) {
        if (current !== generation || !active || disabled) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (current !== generation || !active || disabled) return;
        binaries.push(encodeWorkflowBinary(file.name, bytes, file.type));
      }
      if (current === generation && active && !disabled) onValueChange(JSON.stringify(multiple ? binaries : binaries[0]));
    } catch (cause) { if (current === generation) error = cause instanceof Error ? cause.message : "The file could not be read."; }
  }
</script>
<div class="binary-field">
  {#if disabled}
    <input class="field-input" {id} aria-label={label} value={name} disabled aria-invalid={invalid || undefined} aria-describedby={describedBy} />
  {:else}
    <input class="field-input" {id} aria-label={label} type="file" {multiple} aria-invalid={invalid || undefined} aria-describedby={describedBy}
      onchange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (files.length) void upload(multiple ? files : files.slice(0, 1)); }} />
    {#if name}<span class="file-name">{name}</span>{/if}
  {/if}
  {#if error}<span role="alert">{error}</span>{/if}
</div>
<style>
  .binary-field { flex: 1; min-width: 0; }
  .file-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
