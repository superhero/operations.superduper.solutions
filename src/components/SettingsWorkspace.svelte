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
    { id: "sunflower", name: "Sunflower" },
    { id: "garden-dusk", name: "Garden Dusk" },
    { id: "autumn", name: "Autumn" },
    { id: "rainfall", name: "Rainfall" },
    { id: "graphite-study", name: "Graphite Study" },
    { id: "steel-and-mist", name: "Steel and Mist" },
    { id: "carbon", name: "Carbon" },
    { id: "heritage-noir", name: "Heritage Noir" }
  ] as const;
  export type PaletteId = (typeof palettes)[number]["id"];
</script>

<script lang="ts">
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";

  let { palette, onPaletteChange }: { palette: PaletteId; onPaletteChange: (palette: PaletteId) => void } = $props();
  let heading: HTMLHeadingElement;

  export function focusActive() {
    heading.focus({ preventScroll: true });
  }
</script>

<section class="workspace" aria-label="Settings workspace">
  <h1 bind:this={heading} tabindex="-1">Settings</h1>
  <fieldset aria-describedby="palette-help">
    <legend class="context-label">Color palette</legend>
    <p id="palette-help" class="hint">Light and dark mode use the same palette.</p>
    <div class="palette-options">
      {#each palettes as option (option.id)}
        <label class="palette-choice">
          <input type="radio" name="color-palette" value={option.id} aria-label={option.name}
            checked={palette === option.id} onchange={() => onPaletteChange(option.id)} />
          <span class="palette-card">
            <span class="palette-heading"><strong>{option.name}</strong>
              {#if palette === option.id}<span class="palette-selected" aria-hidden="true"><MaterialIcon name="check_circle" size={18} />Selected</span>{/if}
            </span>
            <span class="palette-swatches" data-palette-preview={option.id} aria-hidden="true">
              {#each [1, 2, 3, 4, 5, 6] as slot (slot)}<span style:background-color={`var(--palette-${slot})`}></span>{/each}
            </span>
          </span>
        </label>
      {/each}
    </div>
  </fieldset>
</section>

<style>
  h1 { margin: 0; font-size: 18px; font-weight: 700; }
  fieldset { min-width: 0; margin: 24px 0 0; padding: 0; border: 0; }
  legend { margin-bottom: 12px; font-weight: 700; }
  .palette-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 16px; margin-top: 16px; }
  .palette-choice { position: relative; min-width: 0; cursor: pointer; }
  .palette-choice input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .palette-card { display: grid; gap: 14px; padding: 14px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background); color: var(--color-foreground); outline: 3px solid transparent; outline-offset: 3px; transition: border-color 180ms ease-in, outline-color 180ms ease-in; }
  input:checked + .palette-card { border-color: var(--color-badge-background); }
  input:focus-visible + .palette-card { outline-color: var(--color-ring); }
  .palette-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .palette-heading strong { font-size: 13px; font-weight: 700; }
  .palette-selected { display: inline-flex; align-items: center; gap: 5px; color: var(--color-muted-foreground); font-size: 11px; }
  .palette-swatches { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--color-surface); border-radius: 3px; }
  .palette-swatches > span { height: 36px; }
  @media (prefers-reduced-motion: reduce) { .palette-card { transition: none; } }
</style>
