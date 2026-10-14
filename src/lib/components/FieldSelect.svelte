<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Select } from "bits-ui";
  import MaterialIcon from "./MaterialIcon.svelte";

  let { id, label, value, options, includePlaceholder = true, required = false, disabled = false, invalid = false, active = true, describedBy, portalZIndex = 40, onValueChange }:
    { id: string; label: string; value: string; options: Array<string | number | boolean | null | { value: string; label: string }>; includePlaceholder?: boolean; required?: boolean;
      disabled?: boolean; invalid?: boolean; active?: boolean; describedBy?: string | undefined; portalZIndex?: number; onValueChange: (value: string) => void } = $props();
  let open = $state(false);
  const items = $derived([
    ...(includePlaceholder ? [{ value: "", label: "Select…" }] : []),
    ...new Map(options.map(option => typeof option === "object" && option !== null
      ? option : { value: String(option), label: String(option) })
      .filter(option => option.value !== "").map(option => [option.value, option])).values()
  ]);

  $effect(() => { if (!active || disabled) open = false; });
</script>

<Select.Root type="single" {value} {onValueChange} name={id} {required} {disabled} {items} bind:open>
  <Select.Trigger {id} class="field-select-trigger" type="button" role="combobox" aria-label={label}
    aria-required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
    <span class="field-select-value" class:placeholder={value === ""}>{items.find(item => item.value === value)?.label ?? (value || "Select…")}</span>
    <MaterialIcon name="expand_more" size={20} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="field-select-content" style={`z-index: ${portalZIndex}`} aria-label={label} side="bottom" sideOffset={4} align="start" collisionPadding={12} preventScroll={false}>
      <Select.Viewport class="field-select-viewport">
        {#each items as item (item.value)}
          <Select.Item value={item.value} label={item.label} class="field-select-option">
            {#snippet children({ selected })}
              <span class="field-select-option-label" class:placeholder={item.value === ""}>{item.label}</span>
              <span class="field-select-check" aria-hidden="true">{#if selected}<MaterialIcon name="check" size={18} />{/if}</span>
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.field-select-trigger) { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 0; background: var(--field-background, var(--color-foreground)); color: var(--field-foreground, var(--color-background)); text-align: left; }
  :global(.field-select-trigger:disabled) { cursor: var(--cursor-not-allowed, not-allowed); opacity: 1; }
  .field-select-value, .field-select-option-label { min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
  .field-select-value.placeholder, .field-select-option-label.placeholder { color: var(--color-surface); font-weight: 400; font-style: italic; }
  :global(.field-select-trigger > .material-symbols-rounded) { flex-shrink: 0; }
  :global(.field-select-content) { --select-slide-y: -8px; z-index: 40; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0; width: var(--bits-select-anchor-width); max-width: min(var(--bits-select-anchor-width), calc(100vw - 24px)); max-height: min(320px, var(--bits-select-content-available-height)); padding: 4px; border: 0; border-radius: 4px; background: var(--color-foreground); color: var(--color-background); box-shadow: none; }
  :global(.field-select-content[data-side="top"]) { --select-slide-y: 8px; }
  :global(.field-select-content[data-state="open"]) { animation: select-slide-in 200ms ease-in both; }
  :global(.field-select-content[data-state="closed"]) { animation: select-slide-out 200ms ease-in both; pointer-events: none; }
  :global(.field-select-viewport) { min-height: 0; overscroll-behavior: contain; }
  :global(.field-select-option) { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; padding: 8px; border-radius: 3px; color: inherit; cursor: var(--cursor-pointer, pointer); outline: none; transition: background-color 180ms ease-in, color 180ms ease-in; }
  :global(.field-select-option[data-highlighted]) { background: var(--color-primary); color: var(--color-primary-foreground); }
  .field-select-check { display: grid; place-items: center; flex: 0 0 18px; width: 18px; height: 18px; }
  @keyframes select-slide-in { from { opacity: 0; translate: 0 var(--select-slide-y); } to { opacity: 1; translate: 0 0; } }
  @keyframes select-slide-out { from { opacity: 1; translate: 0 0; } to { opacity: 0; translate: 0 var(--select-slide-y); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.field-select-content), :global(.field-select-option) { animation: none; transition: none; }
  }
</style>
