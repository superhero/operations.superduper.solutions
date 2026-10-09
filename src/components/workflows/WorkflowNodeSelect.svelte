<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Select } from "bits-ui";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";

  let { label, value, choices, disabled = false, active = true, onchange }: {
    label: string; value: string; choices: { value: string; label: string; symbol?: string }[];
    disabled?: boolean; active?: boolean; onchange: (value: string) => void;
  } = $props();
  let open = $state(false);
  const selected = $derived(choices.find(choice => choice.value === value));
  $effect(() => { if (!active || disabled) open = false; });
</script>

<Select.Root type="single" {value} {disabled} items={choices} onValueChange={onchange} bind:open>
  <Select.Trigger class="workflow-node-select nodrag nopan nokey" role="combobox" aria-label={label} title={selected?.label}>
    <span>{selected?.symbol ?? selected?.label ?? value}</span><MaterialIcon name="expand_more" size={16} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="workflow-node-select-options nodrag nopan nokey nowheel" aria-label={label} sideOffset={5} collisionPadding={10} preventScroll={false}>
      <Select.Viewport>
        {#each choices as choice (choice.value)}
          <Select.Item value={choice.value} label={choice.label} class="workflow-node-select-option">
            {#snippet children({ selected })}
              <span>{choice.label}</span><span class="check" aria-hidden="true">{#if selected}<MaterialIcon name="check" size={16} />{/if}</span>
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.workflow-node-select) { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; min-width: 0; min-height: 30px; padding: 5px 8px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 11px; text-align: left; }
  :global(.workflow-node-select:disabled) { background: var(--color-disabled); color: var(--color-disabled-foreground); }
  :global(.workflow-node-select-options) { z-index: 60; min-width: max(140px, var(--bits-select-anchor-width)); max-width: calc(100vw - 20px); max-height: min(320px, var(--bits-select-content-available-height)); overflow: auto; padding: 4px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); box-shadow: 0 4px 16px color-mix(in srgb, var(--color-foreground) 16%, transparent); }
  :global(.workflow-node-select-option) { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 32px; padding: 6px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; outline: none; transition: background-color 180ms ease-in, color 180ms ease-in; }
  :global(.workflow-node-select-option[data-highlighted]) { background: var(--color-secondary-hover); color: var(--color-secondary-hover-foreground); }
  .check { display: grid; place-items: center; width: 16px; height: 16px; }
  @media (prefers-reduced-motion: reduce) { :global(.workflow-node-select), :global(.workflow-node-select-option) { transition: none; } }
</style>
