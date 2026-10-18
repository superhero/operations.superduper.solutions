<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { toolbarButtonNames, toolbarButtonLabels, type ToolbarButtons } from "$lib/toolbar-settings.ts";
  let { value, onValueChange, error = "", onRetry }: {
    value: ToolbarButtons; onValueChange: (next: ToolbarButtons) => void; error?: string; onRetry: () => void;
  } = $props();
  const options = toolbarButtonNames.toSorted((left, right) => toolbarButtonLabels[left].localeCompare(toolbarButtonLabels[right]));
</script>

<fieldset aria-label="Toolbar button preferences">
  <div class="options">
    {#each options as key}
      <button class="option" type="button" role="switch" aria-checked={value[key]}
        onclick={() => onValueChange({ ...value, [key]: !value[key] })}>
        <span>{toolbarButtonLabels[key]}</span><span class="toggle" aria-hidden="true"><span></span></span>
      </button>
    {/each}
  </div>
  {#if error}<div role="alert"><p>{error}</p><button type="button" onclick={onRetry}>Retry saving</button></div>{/if}
</fieldset>

<style>
  fieldset { min-width: 0; margin: 0; padding: 16px; border: 0; color: var(--color-foreground); }
  .options { display: grid; gap: 6px; }
  .option { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; padding: 2px 10px; border: 0; border-radius: 4px; background: var(--color-surface); color: var(--color-catalog-foreground); font-size: 12px; font-weight: 700; text-align: left; }
  .toggle { box-sizing: border-box; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in, transform 180ms ease-in; }
  .toggle > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .option[aria-checked="true"] .toggle { background: var(--color-catalog-active); }
  .option[aria-checked="true"] .toggle > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  .option:hover .toggle { transform: scale(1.10); }
  p { font-size: 12px; }
  @media (prefers-reduced-motion: reduce) { .toggle, .toggle > span { transition: none; } }
</style>
