<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script module lang="ts">
  export const palettes = [
    { id: "default", name: "Default" },
    { id: "sunset", name: "Sunset" },
    { id: "alpine", name: "Alpine" },
    { id: "obsidian", name: "Obsidian" },
    { id: "midnight-gold", name: "Midnight Gold" },
    { id: "neon", name: "Neon" },
    { id: "lantern", name: "Lantern" },
    { id: "spring", name: "Spring" },
    { id: "bonfire", name: "Bonfire" },
    { id: "harvest-moon", name: "Harvest Moon" },
    { id: "blue-horizon", name: "Blue Horizon" },
    { id: "golden-violet", name: "Golden Violet" },
    { id: "citrus", name: "Citrus" },
    { id: "sunflower", name: "Cappuccino" },
    { id: "garden-dusk", name: "Garden Dusk" },
    { id: "autumn", name: "Autumn" },
    { id: "rainfall", name: "Rainfall" },
    { id: "graphite-study", name: "Graphite" },
    { id: "steel-and-mist", name: "Steel" },
    { id: "carbon", name: "Carbon" },
    { id: "heritage-noir", name: "Heritage Noir" }
  ] as const;
  export type PaletteId = (typeof palettes)[number]["id"];
</script>

<script lang="ts">
  import Disclosure from "$lib/components/Disclosure.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import StorageSettings from "./settings/StorageSettings.svelte";
  import { isValidWorkflowGridSize, workflowGridSizeLimits, type WorkflowDefaults } from "$lib/app-settings.ts";

  let { palette, onPaletteChange, workflowDefaults, onWorkflowDefaultsChange, workflowDefaultsError = "", onRetryWorkflowDefaults }: {
    palette: PaletteId;
    onPaletteChange: (palette: PaletteId) => void;
    workflowDefaults: WorkflowDefaults;
    onWorkflowDefaultsChange: (next: WorkflowDefaults) => void;
    workflowDefaultsError?: string;
    onRetryWorkflowDefaults: () => void;
  } = $props();
  let workspace: HTMLElement;
  let openSection = $state<"theme" | "workflow" | "storage" | null>(null);
  const workflowOptions: { key: "dashed" | "curved" | "snap"; label: string }[] = [
    { key: "dashed", label: "Dashed lines" },
    { key: "curved", label: "Curved lines" },
    { key: "snap", label: "Snap to grid" }
  ];

  function commitGridSize(input: HTMLInputElement) {
    const gridSize = input.valueAsNumber;
    if (!isValidWorkflowGridSize(gridSize)) {
      input.reportValidity();
      return;
    }
    if (gridSize !== workflowDefaults.gridSize) onWorkflowDefaultsChange({ ...workflowDefaults, gridSize });
  }

  export function focusActive() {
    workspace.focus({ preventScroll: true });
  }
</script>

<section class="workspace" aria-label="Settings workspace" bind:this={workspace} tabindex="-1">
  <div class="settings-sections">
    <Disclosure class="catalog-group settings-section" label="Theme" tooltipEnabled={false} open={openSection === "theme"} onToggle={(next) => openSection = next ? "theme" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Theme</h2><span class="section-subtitle">Decide what color the webpage will use</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      <fieldset aria-label="Color palette">
        <div class="palette-options">
          {#each palettes as option (option.id)}
            <label class="palette-choice">
              <input type="radio" name="color-palette" value={option.id} aria-label={option.name}
                checked={palette === option.id} onchange={() => onPaletteChange(option.id)} />
              <span class="palette-card">
                <span class="palette-swatches" data-palette-preview={option.id} aria-hidden="true">
                  {#each [1, 2, 3, 4, 5, 6] as slot (slot)}<span style:background-color={`var(--palette-${slot})`}></span>{/each}
                  <MaterialIcon name="award_star" class="palette-selected-icon" size={64} />
                </span>
                <span class="palette-heading"><strong>{option.name}</strong></span>
              </span>
            </label>
          {/each}
        </div>
      </fieldset>
    </Disclosure>
    <Disclosure class="catalog-group settings-section" label="Workflow" tooltipEnabled={false} open={openSection === "workflow"} onToggle={(next) => openSection = next ? "workflow" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Workflow</h2><span class="section-subtitle">Set the canvas grid and defaults for new workflows</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      <fieldset aria-label="Workflow defaults">
        <div class="workflow-defaults">
          {#each workflowOptions as option (option.key)}
            <button class="workflow-default" type="button" role="switch" aria-checked={workflowDefaults[option.key]}
              onclick={() => onWorkflowDefaultsChange({ ...workflowDefaults, [option.key]: !workflowDefaults[option.key] })}>
              <span>{option.label}</span><span class="default-switch" aria-hidden="true"><span></span></span>
            </button>
          {/each}
        </div>
        <label class="grid-size-setting">
          <span>Grid size</span>
          <span class="grid-size-control">
            <input type="number" value={workflowDefaults.gridSize} min={workflowGridSizeLimits.min} max={workflowGridSizeLimits.max}
              step="1" required onchange={(event) => commitGridSize(event.currentTarget)} />
            <span aria-hidden="true">px</span>
          </span>
        </label>
        {#if workflowDefaultsError}
          <div class="defaults-error"><p role="alert">{workflowDefaultsError}</p><button class="defaults-retry" type="button" onclick={onRetryWorkflowDefaults}>Retry saving</button></div>
        {/if}
      </fieldset>
    </Disclosure>
    <Disclosure class="catalog-group settings-section" label="Storage" tooltipEnabled={false} open={openSection === "storage"} onToggle={(next) => openSection = next ? "storage" : null}>
      {#snippet summary()}
        <div class="section-heading"><h2>Storage</h2><span class="section-subtitle">Explore what is saved in this browser</span></div>
        <MaterialIcon name="chevron_forward" size={17} />
      {/snippet}
      {#if openSection === "storage"}<StorageSettings />{/if}
    </Disclosure>
  </div>
</section>

<style>
  .settings-sections { display: grid; gap: 12px; }
  .settings-sections :global(.settings-section) { border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-muted); transition: background-color 180ms ease-in; }
  .settings-sections :global(.settings-section:has(> summary[aria-expanded="true"])) { background: var(--color-catalog-active); }
  .settings-sections :global(.settings-section > summary) { background: transparent; color: var(--color-catalog-foreground); }
  .settings-sections :global(.settings-section > summary[aria-expanded="true"]) { color: var(--color-catalog-active-foreground); }
  .section-heading { display: grid; gap: 2px; }
  .section-heading h2 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: normal; }
  .section-subtitle { font-size: 12px; font-weight: 400; }
  fieldset { min-width: 0; margin: 0; padding: 16px; border: 0; }
  .workflow-defaults { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 10px; }
  .workflow-default { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 10px 12px; border: 0; border-radius: 4px; background: var(--color-muted); color: var(--color-catalog-foreground); font-size: 12px; font-weight: 700; text-align: left; }
  .workflow-default:focus-visible { outline-color: var(--color-ring); }
  .grid-size-setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 10px; padding: 10px 12px; border-radius: 4px; background: var(--color-muted); color: var(--color-catalog-foreground); font-size: 12px; font-weight: 700; }
  .grid-size-control { display: flex; align-items: center; gap: 8px; }
  .grid-size-control input { width: 72px; min-height: 32px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-catalog-foreground); font: inherit; }
  .grid-size-control input:focus-visible { outline-color: var(--color-ring); }
  .default-switch { flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-surface); transition: background-color 180ms ease-in; }
  .default-switch > span { display: block; width: 18px; height: 18px; border-radius: 2px; background: var(--color-muted-foreground); transform: translateX(0); transition: transform 180ms ease-in, background-color 180ms ease-in; }
  .workflow-default[aria-checked="true"] .default-switch { background: var(--color-catalog-active); }
  .workflow-default[aria-checked="true"] .default-switch > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  .defaults-error { display: grid; justify-items: start; gap: 10px; margin-top: 12px; }
  .defaults-error p { margin: 0; padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .defaults-retry { padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; }
  .palette-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 16px; }
  .palette-choice { position: relative; min-width: 0; cursor: pointer; }
  .palette-choice input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .palette-card { display: grid; padding: 0; border: 4px solid var(--color-muted); border-radius: 4px; background: var(--color-muted); color: var(--color-catalog-foreground); outline: 3px solid transparent; outline-offset: 3px; transition: border-color 180ms ease-in, background-color 180ms ease-in, color 180ms ease-in, outline-color 180ms ease-in; }
  input:checked + .palette-card { color: var(--color-catalog-active-foreground); }
  input:checked + .palette-card .palette-heading { background: var(--color-catalog-active); }
  input:focus-visible + .palette-card { outline-color: var(--color-ring); }
  .palette-heading { position: relative; display: grid; place-items: center; height: 37px; margin-top: -1px; padding: 1px 8px 0; background: var(--color-muted); text-align: center; transition: background-color 180ms ease-in; }
  .palette-heading strong { font-size: 13px; font-weight: 700; }
  .palette-swatches { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); overflow: hidden; }
  .palette-swatches > span { height: 108px; }
  .palette-swatches :global(.palette-selected-icon) { position: absolute; top: 50%; left: 50%; width: 64px; height: 64px; transform: translate(-50%, -50%) scale(0); color: var(--color-catalog-active); text-shadow: 0 2px 4px var(--color-catalog-active-foreground); font-variation-settings: "FILL" 1; transition: transform 180ms ease-in, color 180ms ease-in, text-shadow 180ms ease-in; pointer-events: none; }
  input:checked + .palette-card :global(.palette-selected-icon) { transform: translate(-50%, -50%) scale(1); transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease-in, text-shadow 180ms ease-in; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .palette-choice { z-index: 0; will-change: transform; transition: transform 180ms ease-in, z-index 0s linear 180ms; }
    .palette-choice:hover { z-index: 2; transform: scale(min(1.10, var(--hover-scale, 1.10))); transition-delay: 0s; }
  }
  @media (prefers-reduced-motion: reduce) { .palette-card, .palette-heading, .default-switch, .default-switch > span { transition: none; } }
</style>
