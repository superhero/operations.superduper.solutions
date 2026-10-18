<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { toolbarButtonGroups, toolbarButtonLabels, type ToolbarButtons } from "$lib/toolbar-settings.ts";
  let { value, onValueChange, error = "", onRetry }: {
    value: ToolbarButtons; onValueChange: (next: ToolbarButtons) => void; error?: string; onRetry: () => void;
  } = $props();
  const id = $props.id();
</script>

<fieldset aria-label="Toolbar button preferences">
  <div class="groups">
    {#each toolbarButtonGroups as group}
      <div class="button-group" role="group" aria-labelledby={`${id}-${group.label}`}>
        <h3 id={`${id}-${group.label}`}>{group.label}</h3>
        <div class="options">
          {#each group.buttons as key}
            <button class="option" type="button" role="switch" aria-checked={value[key]}
              onclick={() => onValueChange({ ...value, [key]: !value[key] })}>
              <span>{toolbarButtonLabels[key]}</span><span class="toggle" aria-hidden="true"><span></span></span>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
  {#if error}<div role="alert"><p>{error}</p><button type="button" onclick={onRetry}>Retry saving</button></div>{/if}
</fieldset>

<style>
  fieldset { min-width: 0; margin: 0; padding: 16px; border: 0; color: var(--color-foreground); container-type: inline-size; }
  .groups { columns: 3; column-gap: 10px; }
  .button-group { display: inline-block; box-sizing: border-box; width: 100%; min-width: 0; margin: 0 0 10px; padding: 10px; break-inside: avoid; border-radius: 4px; background: var(--color-surface); color: var(--color-catalog-foreground); }
  h3 { margin: 0 0 6px; padding: 0 10px 8px; background: repeating-linear-gradient(to right, var(--color-background) 0 6px, transparent 6px 14px) 10px bottom / calc(100% - 20px) 1px no-repeat; color: var(--color-accent); font-size: 14px; line-height: 2; font-weight: 700; }
  .options { display: grid; gap: 6px; }
  .option { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; padding: 2px 10px; border: 0; border-radius: 4px; background: var(--color-surface); color: var(--color-catalog-foreground); font-size: 12px; font-weight: 700; text-align: left; }
  .option > span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .toggle { box-sizing: border-box; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); transition: background-color 180ms ease-in, transform 180ms ease-in; }
  .toggle > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-surface); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .option[aria-checked="true"] .toggle { background: var(--color-catalog-active); }
  .option[aria-checked="true"] .toggle > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  .option:hover .toggle { transform: scale(1.10); }
  p { font-size: 12px; }
  @container (max-width: 520px) { .groups { columns: 2; } }
  @container (max-width: 360px) { .groups { columns: 1; } }
  @media (prefers-reduced-motion: reduce) { .toggle, .toggle > span { transition: none; } }
</style>
