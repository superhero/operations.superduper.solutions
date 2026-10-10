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

  let { palette, onPaletteChange }: { palette: PaletteId; onPaletteChange: (palette: PaletteId) => void } = $props();
  let workspace: HTMLElement;
  let themeOpen = $state(false);

  export function focusActive() {
    workspace.focus({ preventScroll: true });
  }
</script>

<section class="workspace" aria-label="Settings workspace" bind:this={workspace} tabindex="-1">
  <div class="settings-sections">
    <Disclosure class="catalog-group settings-section" label="Theme" tooltipEnabled={false} open={themeOpen} onToggle={(next) => themeOpen = next}>
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
  @media (prefers-reduced-motion: reduce) { .palette-card, .palette-heading { transition: none; } }
</style>
