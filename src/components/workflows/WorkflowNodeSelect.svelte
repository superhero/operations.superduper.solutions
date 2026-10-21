<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Select, mergeProps } from "bits-ui";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import FieldSelectOptions from "$lib/components/FieldSelectOptions.svelte";

  let { label, value, choices, disabled = false, active = true, onchange }: {
    label: string; value: string; choices: { value: string; label: string; symbol?: string; placeholder?: boolean; bold?: boolean; disabled?: boolean }[];
    disabled?: boolean; active?: boolean; onchange: (value: string) => void;
  } = $props();
  let open = $state(false);
  const selected = $derived(choices.find(choice => choice.value === value));
  $effect(() => { if (!active || disabled) open = false; });
</script>

<Select.Root type="single" {value} {disabled} items={choices} onValueChange={onchange} bind:open>
  <Select.Trigger class="workflow-node-select nodrag nopan nokey" role="combobox" aria-label={label}>
    {#snippet child({ props: selectProps })}
      <HintButton tooltipSide="left" tooltipAnchorSelector=".svelte-flow__node" label={selected?.label ?? value} labelAsName={false} tooltipEnabled={!open}>
        {#snippet child({ props: hintProps })}
          <button {...mergeProps(hintProps, selectProps)}>
            <span class="select-label" class:bold={selected?.bold} class:placeholder={selected?.placeholder}>{selected?.symbol ?? selected?.label ?? value}</span><MaterialIcon name="expand_more" size={16} />
          </button>
        {/snippet}
      </HintButton>
    {/snippet}
  </Select.Trigger>
  <FieldSelectOptions {label} items={choices} portalZIndex={60} variant="node" />
</Select.Root>

<style>
  :global(.workflow-node-select) { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; min-width: 0; min-height: 30px; padding: 5px 8px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font-size: 11px; text-align: left; }
  :global(.workflow-node-select:disabled) { background: var(--color-disabled); color: var(--color-disabled-foreground); }
  .select-label { min-width: 0; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bold { font-weight: 700; }
  .placeholder { font-style: italic; font-weight: 400; }
  @media (prefers-reduced-motion: reduce) { :global(.workflow-node-select) { transition: none; } }
</style>
