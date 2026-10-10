<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Controls, useSvelteFlow, useStore } from "@xyflow/svelte";
  import { DropdownMenu } from "bits-ui";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  let { canvas, active, navigationOpen, menuOpen = $bindable(false), snap, curved, dashed, selected, onsnap, oncurved, ondashed, onremove, onnew, onopen, onsave, onexport, onimport, onbrowse, onutility, ondescribe, onrun }:
    { canvas: HTMLElement | undefined; active: boolean; navigationOpen: boolean; menuOpen?: boolean; snap: boolean; curved: boolean; dashed: boolean; selected: boolean;
      onsnap: () => void; oncurved: () => void; ondashed: () => void; onremove: () => void;
      onnew: () => void; onopen: () => void; onsave: () => void; onexport: () => void;
      onimport: () => void; onbrowse: () => void; onutility: (type: "switch" | "cast" | "comment") => void;
      ondescribe: () => void; onrun: () => void } = $props();
  const { fitView, getInternalNode, getNodes, zoomIn, zoomOut } = useSvelteFlow();
  const store = useStore();
  const minZoomReached = $derived(store.viewport.zoom <= store.minZoom);
  const maxZoomReached = $derived(store.viewport.zoom >= store.maxZoom);
  const ariaLabels = $derived(store.ariaLabelConfig);
  let alive = true;
  onDestroy(() => { alive = false; });

  async function waitForLayout() {
    for (let frame = 0; frame < 60; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!alive || !active) return false;
      if (canvas?.clientWidth && canvas.clientHeight && store.width === canvas.clientWidth && store.height === canvas.clientHeight)
        return true;
    }
    return false;
  }

  async function keepNodesVisible() {
    if (!await waitForLayout() || !canvas || !getNodes().length) return;
    const bounds = canvas.getBoundingClientRect();
    const visible = [...canvas.querySelectorAll(".svelte-flow__node:not(.svelte-flow__node-data)")].some(element => {
      const node = element.getBoundingClientRect();
      return node.width > 0 && node.left >= bounds.left && node.right <= bounds.right &&
        node.top >= bounds.top && node.bottom <= bounds.bottom;
    });
    if (!visible) await fitView({ padding: 0.25, minZoom: 0.25, maxZoom: 1, duration: 0 });
  }

  onMount(() => {
    const controls = canvas?.querySelector<HTMLElement>(".workflow-toolbar");
    const observer = new ResizeObserver(() => {
      if (controls && canvas) {
        const bounds = controls.getBoundingClientRect();
        canvas.style.setProperty("--workflow-toolbar-height", `${bounds.height}px`);
        canvas.style.setProperty("--workflow-toolbar-width", `${bounds.width}px`);
      }
      void keepNodesVisible();
    });
    if (controls) observer.observe(controls);
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  });

  $effect(() => { if (active) void keepNodesVisible(); });

  export async function reveal(ids: string | string[]) {
    const requested = typeof ids === "string" ? [ids] : ids;
    if (!await waitForLayout()) return;
    for (let frame = 0; frame < 60; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!alive || !active) return;
      const measured = requested.every(id => { const node = getInternalNode(id); return node?.measured.width && node.measured.height; });
      if (canvas?.clientWidth && canvas.clientHeight && measured) {
        await fitView({ nodes: requested.map(id => ({ id })), padding: 0.25, minZoom: 0.25, maxZoom: 1, duration: 0 });
        return;
      }
    }
  }
</script>

<Controls position="top-right" orientation="horizontal" class="workflow-toolbar" showLock={false} showZoom={false} showFitView={false}>
  {#snippet before()}
    <div class="workflow-control-group">
    <HintButton class="svelte-flow__controls-button" aria-label="Browse operations" label="Browse operations" aria-pressed={navigationOpen} aria-controls="side-navigation" onclick={onbrowse}><MaterialIcon name="list" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Switch" label="Switch" onclick={() => onutility("switch")}><MaterialIcon name="alt_route" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Cast" label="Cast" onclick={() => onutility("cast")}><MaterialIcon name="transform" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Comment" label="Comment" onclick={() => onutility("comment")}><MaterialIcon name="comment" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Remove selected" label="Remove selected" disabled={!selected} onclick={onremove}><MaterialIcon name="delete" size={18} /></HintButton>
    </div><div class="workflow-control-group">
    <HintButton class="svelte-flow__controls-button" aria-label="Dashed connections" label="Dashed connections" aria-pressed={dashed} onclick={ondashed}><MaterialIcon name="unknown_med" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Curved connections" label="Curved connections" aria-pressed={curved} onclick={oncurved}><MaterialIcon name="line_curve" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Snap to grid" label="Snap to grid" aria-pressed={snap} onclick={onsnap}><MaterialIcon name="grid_on" size={18} /></HintButton>
    </div><div class="workflow-control-group">
    <HintButton class="svelte-flow__controls-button" aria-label={ariaLabels["controls.zoomIn.ariaLabel"]} label={ariaLabels["controls.zoomIn.ariaLabel"]}
      disabled={maxZoomReached} onclick={() => { void zoomIn(); }}><MaterialIcon name="add" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label={ariaLabels["controls.zoomOut.ariaLabel"]} label={ariaLabels["controls.zoomOut.ariaLabel"]}
      disabled={minZoomReached} onclick={() => { void zoomOut(); }}><MaterialIcon name="remove" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label={ariaLabels["controls.fitView.ariaLabel"]} label={ariaLabels["controls.fitView.ariaLabel"]}
      onclick={() => { void fitView({ padding: 0.2, maxZoom: 1 }); }}><MaterialIcon name="fit_screen" size={18} /></HintButton>
    </div>
  {/snippet}
  {#snippet after()}
    <div class="workflow-control-group">
    <HintButton class="svelte-flow__controls-button" aria-label="New workflow" label="New workflow" onclick={onnew}><MaterialIcon name="flowsheet" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Open workflow" label="Open workflow" onclick={onopen}><MaterialIcon name="folder_open" size={18} /></HintButton>
    <HintButton class="svelte-flow__controls-button" aria-label="Describe workflow" label="Describe workflow" onclick={ondescribe}><MaterialIcon name="description" size={18} /></HintButton>
    </div>
    <div class="workflow-control-group">
      <DropdownMenu.Root bind:open={menuOpen}>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <HintButton {...props} class="svelte-flow__controls-button" label="Workflow actions"><MaterialIcon name="menu" size={18} /></HintButton>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="workflow-file-menu" align="end" sideOffset={8} collisionPadding={12} preventScroll={false} strategy="fixed">
            <DropdownMenu.Item class="workflow-file-item" onSelect={onsave}><MaterialIcon name="save" size={18} />Save workflow</DropdownMenu.Item>
            <DropdownMenu.Item class="workflow-file-item" onSelect={onrun}><MaterialIcon name="play_arrow" size={18} />Run workflow</DropdownMenu.Item>
            <DropdownMenu.Item class="workflow-file-item" onSelect={onexport}><MaterialIcon name="download" size={18} />Export workflow</DropdownMenu.Item>
            <DropdownMenu.Item class="workflow-file-item" onSelect={onimport}><MaterialIcon name="upload" size={18} />Import workflow</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  {/snippet}
</Controls>

<style>
  .workflow-control-group { display: flex; flex: 0 0 auto; gap: 1px; }
  .workflow-control-group :global(button:first-child) { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
  .workflow-control-group :global(button:last-child) { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
  :global(.workflow-toolbar) { display: flex; flex-wrap: wrap; justify-content: flex-end; max-width: calc(100% - 2rem); gap: 6px; margin: 1rem; padding: 3px; border-radius: 4px; background: var(--color-surface); box-shadow: none; }
  :global(.workflow-toolbar .svelte-flow__controls-button) { width: 30px; height: 30px; padding: 6px; border: 0; border-radius: 0; background: var(--color-background); color: var(--color-foreground); transition: color 180ms ease-in, background-color 180ms ease-in, opacity 180ms ease-in, outline-color 180ms ease-in, transform 180ms ease-in; }
  :global(.workflow-toolbar.svelte-flow__controls.horizontal .svelte-flow__controls-button) { border: 0; }
  :global(.workflow-toolbar .svelte-flow__controls-button:is(:hover,:focus-visible):not(:disabled):not([aria-pressed="true"])) { color: var(--color-secondary-hover-foreground); background: var(--color-secondary-hover); }
  :global(.workflow-toolbar .svelte-flow__controls-button[aria-pressed="true"]) { background: var(--color-catalog-active); color: var(--color-catalog-active-foreground); }
  :global(.workflow-toolbar .svelte-flow__controls-button:disabled) { pointer-events: auto; background: var(--color-background); color: var(--color-disabled-foreground); }
  :global(.workflow-file-menu) { z-index: 60; min-width: 190px; max-width: calc(100vw - 24px); padding: 5px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); box-shadow: 0 4px 16px color-mix(in srgb, var(--color-foreground) 12%, transparent); }
  :global(.workflow-file-item) { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 7px 10px; border-radius: 3px; font-size: 12px; cursor: pointer; outline: none; transition: color 180ms ease-in, background-color 180ms ease-in; }
  :global(.workflow-file-item[data-highlighted]) { background: var(--color-secondary-hover); color: var(--color-secondary-hover-foreground); }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    :global(.workflow-toolbar button:not(:disabled):not([inert] *)) { will-change: transform; }
    :global(.workflow-toolbar button:hover:not(:disabled)) { transform: scale(min(1.10, var(--hover-scale, 1.10))); }
  }
</style>
