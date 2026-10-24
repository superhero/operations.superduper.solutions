<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Select } from "bits-ui";
  import type { Snippet } from "svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  import FieldSelectOptions from "./FieldSelectOptions.svelte";

  let { id, label, value, options, includePlaceholder = true, required = false, disabled = false, invalid = false, active = true, describedBy, portalZIndex = 40, renderLabel, onValueChange }:
    { id: string; label: string; value: string; options: Array<string | number | boolean | null | { value: string; label: string; disabled?: boolean }>; includePlaceholder?: boolean; required?: boolean;
      disabled?: boolean; invalid?: boolean; active?: boolean; describedBy?: string | undefined; portalZIndex?: number;
      renderLabel?: Snippet<[{ value: string; label: string }]>; onValueChange: (value: string) => void } = $props();
  let open = $state(false);
  const items = $derived([
    ...(includePlaceholder ? [{ value: "", label: "Select…" }] : []),
    ...new Map(options.map(option => typeof option === "object" && option !== null
      ? option : { value: String(option), label: String(option) })
      .filter(option => option.value !== "").map(option => [option.value, option])).values()
  ]);
  const selectedItem = $derived(items.find(item => item.value === value));

  $effect(() => { if (!active || disabled) open = false; });
</script>

{#snippet itemLabel(item: { value: string; label: string })}{#if renderLabel && item.value}{@render renderLabel(item)}{:else}{item.label}{/if}{/snippet}

<Select.Root type="single" {value} {onValueChange} name={id} {required} {disabled} {items} bind:open>
  <Select.Trigger {id} class="field-select-trigger" type="button" role="combobox" aria-label={label}
    aria-required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
    <span class="field-select-value" class:placeholder={value === ""}>{#if selectedItem}{@render itemLabel(selectedItem)}{:else}{value || "Select…"}{/if}</span>
    <MaterialIcon name="expand_more" size={20} />
  </Select.Trigger>
  <FieldSelectOptions {label} {items} {portalZIndex} {renderLabel} />
</Select.Root>

<style>
  :global(.field-select-trigger) { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 0; background: var(--field-background, var(--color-foreground)); color: var(--field-foreground, var(--color-background)); text-align: left; }
  :global(.field-select-trigger:disabled) { cursor: not-allowed; opacity: 1; }
  .field-select-value { min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
  .field-select-value.placeholder { color: var(--color-surface); font-weight: 400; font-style: italic; }
  :global(.field-select-trigger > .material-symbols-rounded) { flex-shrink: 0; }
</style>
