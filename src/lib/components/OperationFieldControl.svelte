<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import type { InputField } from "$lib/catalog.ts";
  import FieldSelect from "./FieldSelect.svelte";
  import FieldNumber from "./FieldNumber.svelte";

  let { field, id, value, onValueChange, required = field.required, disabled = false, invalid = false,
    active = true, describedBy, multiline = false, portalZIndex = 40 }:
    { field: InputField; id: string; value: string; onValueChange: (value: string) => void;
      required?: boolean; disabled?: boolean; invalid?: boolean; active?: boolean; describedBy?: string | undefined;
      multiline?: boolean; portalZIndex?: number } = $props();
  const structured = $derived(["object", "array", "null"].includes(field.type));
  const placeholder = $derived(field.type === "object" ? '{"name": "Example"}' : field.type === "array" ? '["example", "values"]' : field.type === "null" ? "null" : "");
</script>

{#if field.enum || field.type === "boolean"}
  <FieldSelect {id} label={field.label} {value} options={field.enum ?? [true, false]} {active} {disabled}
    {onValueChange} {required} {invalid} {describedBy} {portalZIndex} />
{:else if field.type === "number" || field.type === "integer"}
  <FieldNumber {id} label={field.label} {value} integer={field.type === "integer"} minimum={field.minimum}
    maximum={field.maximum} {onValueChange} {required} {disabled} {invalid} {describedBy} />
{:else if structured || multiline}
  <textarea class="field-input" class:json-input={structured} {id} aria-label={field.label} {value} {required} {disabled}
    aria-invalid={invalid || undefined} aria-describedby={describedBy} {placeholder} rows={field.type === "null" ? 1 : 4}
    spellcheck={!structured} oninput={(event) => onValueChange(event.currentTarget.value)}></textarea>
{:else}
  <input class="field-input" {id} aria-label={field.label} type="text" {value} {required} {disabled}
    aria-invalid={invalid || undefined} aria-describedby={describedBy} oninput={(event) => onValueChange(event.currentTarget.value)} />
{/if}

<style>
  textarea { display: block; resize: vertical; max-height: 420px; line-height: 1.6; }
  .json-input { font-family: ui-monospace, monospace; font-size: 13px; }
  textarea::placeholder { color: var(--color-surface); opacity: 1; }
</style>
