<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Select } from "bits-ui";
  import type { Snippet } from "svelte";
  import MaterialIcon from "./MaterialIcon.svelte";

  type Option = { value: string; label: string; disabled?: boolean; bold?: boolean; placeholder?: boolean };
  let { label, items, portalZIndex = 40, variant = "field", renderLabel }: {
    label: string; items: Option[]; portalZIndex?: number; variant?: "field" | "node";
    renderLabel?: Snippet<[{ value: string; label: string }]> | undefined;
  } = $props();
  let viewport = $state<HTMLElement | null>(null);
  let hoveredItem: HTMLElement | null = null;
  let clippedItem = false;
  const resetHover = () => { hoveredItem = null; clippedItem = false; };
  $effect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(resetHover);
    observer.observe(viewport);
    return () => { observer.disconnect(); resetHover(); };
  });

  function keepClippedHoverStill(event: PointerEvent) {
    if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
    const list = event.currentTarget as HTMLElement;
    const item = event.target.closest<HTMLElement>("[data-select-item]");
    if (item !== hoveredItem) {
      hoveredItem = item;
      clippedItem = !!item && (item.offsetTop < list.scrollTop
        || item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight);
    }
    // Bits UI scrolls newly highlighted items into view, including pointer hovers.
    // A clipped row must remain still under the pointer; click and keys still work.
    if (clippedItem) event.stopPropagation();
  }
</script>

<Select.Portal>
  <Select.Content class={variant === "node" ? "select-options workflow-node-select-options nodrag nopan nokey nowheel" : "select-options field-select-content"}
    style={`z-index: ${portalZIndex}`} data-variant={variant} aria-label={label} side="bottom" sideOffset={variant === "node" ? 5 : 4}
    align="start" collisionPadding={variant === "node" ? 10 : 12} preventScroll={false}>
    <Select.Viewport class="select-options-viewport field-select-viewport" bind:ref={viewport}
      onpointermovecapture={keepClippedHoverStill} onpointerleave={resetHover} onscroll={resetHover}>
      {#each items as item (item.value)}
        <Select.Item value={item.value} label={item.label} disabled={item.disabled ?? false}
          class={variant === "node" ? "select-option workflow-node-select-option" : "select-option field-select-option"}>
          {#snippet children({ selected })}
            <span class="option-label field-select-option-label" class:bold={item.bold}
              class:placeholder={variant === "node" ? item.placeholder : item.value === ""}>
              {#if renderLabel && item.value}{@render renderLabel(item)}{:else}{item.label}{/if}
            </span>
            <span class="select-check" aria-hidden="true">{#if selected}<MaterialIcon name="check" size={variant === "node" ? 16 : 18} />{/if}</span>
          {/snippet}
        </Select.Item>
      {/each}
    </Select.Viewport>
  </Select.Content>
</Select.Portal>

<style>
  :global(.select-options) { --select-slide-y: -8px; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0; width: var(--bits-select-anchor-width); max-width: min(var(--bits-select-anchor-width), calc(100vw - 24px)); max-height: min(320px, var(--bits-select-content-available-height)); overflow: hidden; padding: 4px; border: 0; border-radius: 4px; background: var(--color-foreground); color: var(--color-background); box-shadow: none; }
  :global(.field-select-content[data-side="top"]) { --select-slide-y: 8px; }
  :global(.field-select-content[data-state="open"]) { animation: select-slide-in 200ms ease-in both; }
  :global(.field-select-content[data-state="closed"]) { animation: select-slide-out 200ms ease-in both; pointer-events: none; }
  :global(.select-options-viewport) { min-height: 0; overscroll-behavior: contain; scrollbar-gutter: stable; }
  /* Bits UI hides viewport bars; these lists use the app's native scrollbars. */
  :global(.select-options-viewport[data-select-viewport]) { scrollbar-width: thin !important; }
  :global(.select-options-viewport[data-select-viewport]::-webkit-scrollbar) { display: block !important; }
  @supports selector(::-webkit-scrollbar) {
    :global(.select-options-viewport[data-select-viewport]) { scrollbar-width: auto !important; }
  }
  :global(.select-option) { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; padding: 8px; border-radius: 3px; color: inherit; cursor: pointer; outline: none; transition: background-color 180ms ease-in, color 180ms ease-in; }
  :global(.field-select-option[data-highlighted]) { background: var(--color-primary); color: var(--color-primary-foreground); }
  :global(.select-option[data-disabled]) { color: var(--color-disabled-foreground); cursor: not-allowed; }
  .option-label { min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
  .option-label.placeholder { color: var(--color-surface); font-weight: 400; font-style: italic; }
  .select-check { display: grid; place-items: center; flex: 0 0 18px; width: 18px; height: 18px; }
  :global(.workflow-node-select-options) { min-width: max(140px, var(--bits-select-anchor-width)); width: auto; max-width: calc(100vw - 20px); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-foreground); }
  :global(.workflow-node-select-option) { min-height: 32px; padding: 6px 8px; border-radius: 4px; font-size: 12px; }
  :global(.workflow-node-select-option[data-highlighted]) { background: var(--color-secondary-hover); color: var(--color-secondary-hover-foreground); }
  :global(.workflow-node-select-option) .option-label { font-weight: 400; }
  :global(.workflow-node-select-option) .option-label.bold { font-weight: 700; }
  :global(.workflow-node-select-option) .option-label.placeholder { color: inherit; font-weight: 400; }
  :global(.workflow-node-select-option) .select-check { flex-basis: 16px; width: 16px; height: 16px; }
  @keyframes select-slide-in { from { opacity: 0; translate: 0 var(--select-slide-y); } to { opacity: 1; translate: 0 0; } }
  @keyframes select-slide-out { from { opacity: 1; translate: 0 0; } to { opacity: 0; translate: 0 var(--select-slide-y); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.field-select-content), :global(.select-option) { animation: none; transition: none; }
  }
</style>
