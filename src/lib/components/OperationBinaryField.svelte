<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { encodeWorkflowBinary, maxWorkflowUploadBytes, validateWorkflowBinary } from "../workflow-binary.ts";
  let { id, label, value, onValueChange, disabled, active, invalid, describedBy }:
    { id: string; label: string; value: string; onValueChange: (value: string) => void;
      disabled: boolean; active: boolean; invalid: boolean; describedBy?: string | undefined } = $props();
  let error = $state("");
  let generation = 0;
  onDestroy(() => generation++);
  $effect(() => { if (!active || disabled) generation++; });
  const name = $derived.by(() => { try { return validateWorkflowBinary(JSON.parse(value)).name; } catch { return ""; } });
  async function upload(file: File) {
    const current = ++generation;
    error = "";
    try {
      if (file.size > maxWorkflowUploadBytes) throw new Error("Files must be no larger than 500 kB.");
      const binary = encodeWorkflowBinary(file.name, new Uint8Array(await file.arrayBuffer()), file.type);
      if (current === generation && active && !disabled) onValueChange(JSON.stringify(binary));
    } catch (cause) { if (current === generation) error = cause instanceof Error ? cause.message : "The file could not be read."; }
  }
</script>
<div class="binary-field">
  {#if disabled}
    <input class="field-input" {id} aria-label={label} value={name} disabled aria-invalid={invalid || undefined} aria-describedby={describedBy} />
  {:else}
    <input class="field-input" {id} aria-label={label} type="file" aria-invalid={invalid || undefined} aria-describedby={describedBy}
      onchange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
    {#if name}<span class="file-name">{name}</span>{/if}
  {/if}
  {#if error}<span role="alert">{error}</span>{/if}
</div>
<style>
  .binary-field { flex: 1; min-width: 0; }
  .file-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
