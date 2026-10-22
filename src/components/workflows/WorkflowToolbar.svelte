<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { workflowLineStyleLabels, type WorkflowLineStyle } from "$lib/workflow-line-style.ts";
  import { defaultToolbarButtons, toolbarButtonGroups, type ToolbarButtons } from "$lib/toolbar-settings.ts";
  import { onMount, onDestroy, tick } from "svelte";
  import { Controls, getViewportForBounds, useSvelteFlow, useStore } from "@xyflow/svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  let { buttons = defaultToolbarButtons, oncopy, oncut, onpaste, canPaste = false, canRun = false, canvas, active, settingsOpen = false, placing = false, navigationOpen, snap, curved, lineStyle, dashed, selected, onsnap, oncurved, ondashed, onremove, onnew, onopen, onexport, onimport, onbrowse, onutility, ondescribe, onrun, canUndo, canRedo, historyBusy, onundo, onredo, onhistory }:
    { buttons?: ToolbarButtons; oncopy: () => void; oncut: () => void; onpaste: () => void; canPaste?: boolean; canvas: HTMLElement | undefined; active: boolean; settingsOpen?: boolean; placing?: boolean; navigationOpen: boolean; snap: boolean; curved: boolean; lineStyle: WorkflowLineStyle; dashed: boolean; selected: boolean;
      onsnap: () => void; oncurved: () => void; ondashed: () => void; onremove: () => void;
      onnew: () => void; onopen: () => void; onexport: () => void;
      onimport: () => void; onbrowse: () => void; onutility: (type: "switch" | "cast" | "comment" | "vault" | "file" | "transform" | "filter" | "assert" | "stop") => void;
      ondescribe: () => void; onrun: () => void; canRun?: boolean; canUndo: boolean; canRedo: boolean; historyBusy: boolean;
      onundo: () => void; onredo: () => void; onhistory: () => void } = $props();
  $effect(() => { void buttons; void tick().then(() => compactLayout?.()); });
  const { getInternalNode, getNodes, getNodesBounds, getViewport, setViewport, zoomIn, zoomOut } = useSvelteFlow();
  const store = useStore();
  const minZoomReached = $derived(store.viewport.zoom <= store.minZoom);
  const maxZoomReached = $derived(store.viewport.zoom >= store.maxZoom);
  const ariaLabels = $derived(store.ariaLabelConfig);
  let alive = true;
  let revealing = false;
  let revealGeneration = 0;
  let cancelReveal: (() => void) | undefined;
  let compactLayout: (() => void) | undefined;
  onDestroy(() => { alive = false; cancelReveal?.(); });

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
    const generation = revealGeneration;
    if (placing || revealing || !await waitForLayout() || placing || revealing || generation !== revealGeneration || !canvas || !getNodes().length) return;
    const bounds = canvas.getBoundingClientRect();
    const visible = [...canvas.querySelectorAll(".svelte-flow__node:not(.svelte-flow__node-data)")].some(element => {
      const node = element.getBoundingClientRect();
      return node.width > 0 && node.left >= bounds.left && node.right <= bounds.right &&
        node.top >= bounds.top && node.bottom <= bounds.bottom;
    });
    if (!visible) {
      // Resizing may reveal a nearby node, but must never change the user's scale.
      const area = visibleCanvasArea();
      const center = { x: bounds.left + area.x + area.width / 2, y: bounds.top + area.y + area.height / 2 };
      const nearest = [...canvas.querySelectorAll(".svelte-flow__node:not(.svelte-flow__node-data)")]
        .map(element => element.getBoundingClientRect()).filter(node => node.width > 0 && node.height > 0)
        .sort((a, b) => Math.hypot(a.x + a.width / 2 - center.x, a.y + a.height / 2 - center.y) -
          Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y))[0];
      if (!nearest) return;
      const viewport = getViewport();
      await setViewport({ ...viewport, x: viewport.x + center.x - nearest.x - nearest.width / 2,
        y: viewport.y + center.y - nearest.y - nearest.height / 2 }, { duration: 0 });
    }
  }

  // Flex wrapping leaves the container at its width limit, even when no row fills it.
  function packedWidth(widths: number[], available: number, gap: number) {
    let row = 0, widest = 0;
    for (const width of widths) {
      if (row && row + gap + width > available) { widest = Math.max(widest, row); row = 0; }
      row = row ? row + gap + width : width;
    }
    return Math.max(widest, row);
  }

  onMount(() => {
    const element = canvas;
    let compactFrame = 0;
    const compact = () => {
      compactFrame = 0;
      const toolbar = element?.querySelector<HTMLElement>('.workflow-toolbar');
      if (!element || !toolbar) return;
      const style = getComputedStyle(toolbar);
      const chrome = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']
        .reduce((sum, property) => sum + (parseFloat(style.getPropertyValue(property)) || 0), 0);
      const available = element.getBoundingClientRect().width - (parseFloat(style.right) || 0) -
        (parseFloat(style.getPropertyValue("--navigation-inset")) || 0) -
        parseFloat(style.marginLeft) - parseFloat(style.marginRight) - chrome;
      if (available <= 0) return;
      const widths = [...toolbar.querySelectorAll<HTMLElement>('.workflow-control-group')].map(group =>
        packedWidth([...group.children].map(button => button.getBoundingClientRect().width), available, parseFloat(getComputedStyle(group).columnGap) || 0));
      const width = `${Math.ceil(packedWidth(widths, available, parseFloat(style.columnGap) || 0) + chrome)}px`;
      if (toolbar.style.width !== width) toolbar.style.width = width;
    };
    const scheduleCompact = () => { if (!compactFrame) compactFrame = requestAnimationFrame(compact); };
    compactLayout = scheduleCompact;
    const finishMove = (event: TransitionEvent) => { if (event.target instanceof Element && event.target.matches('.workflow-toolbar')) scheduleCompact(); };
    scheduleCompact();
    element?.addEventListener('transitionend', finishMove);
    const interruptReveal = () => {
      if (!revealing) return;
      revealGeneration += 1;
      cancelReveal?.();
      cancelReveal = undefined;
      revealing = false;
      void setViewport(getViewport(), { duration: 0 });
    };
    const observer = new ResizeObserver(() => {
      scheduleCompact();
      void keepNodesVisible();
    });
    if (element) {
      observer.observe(element);
      element.addEventListener("pointerdown", interruptReveal, true);
      element.addEventListener("wheel", interruptReveal, { capture: true, passive: true });
    }
    return () => {
      observer.disconnect();
      compactLayout = undefined;
      cancelAnimationFrame(compactFrame);
      element?.removeEventListener('transitionend', finishMove);
      element?.removeEventListener("pointerdown", interruptReveal, true);
      element?.removeEventListener("wheel", interruptReveal, true);
    };
  });

  $effect(() => { if (active) void keepNodesVisible(); compactLayout?.(); });
  $effect(() => { void settingsOpen; void navigationOpen; compactLayout?.(); });

  function visibleCanvasArea() {
    const bounds = canvas!.getBoundingClientRect();
    const toolbar = canvas!.querySelector(".workflow-toolbar");
    const style = toolbar && getComputedStyle(toolbar);
    const left = 24 + (style ? parseFloat(style.getPropertyValue("--navigation-inset")) || 0 : 0);
    const right = 24 + (style ? parseFloat(style.right) || 0 : 0);
    const top = Math.max(24, (toolbar?.getBoundingClientRect().bottom ?? bounds.top) - bounds.top + 24);
    return { x: left, y: top, width: Math.max(1, canvas!.clientWidth - left - right), height: Math.max(1, canvas!.clientHeight - top - 24) };
  }

  async function fitVisibleCanvas() {
    if (!await waitForLayout()) return;
    const nodes = getNodes().filter(node => !node.hidden && node.measured?.width && node.measured.height);
    if (!nodes.length) return;
    const area = visibleCanvasArea();
    const viewport = getViewportForBounds(getNodesBounds(nodes), area.width, area.height, store.minZoom, Math.min(1, store.maxZoom), 0.2);
    await setViewport({ ...viewport, x: area.x + viewport.x, y: area.y + viewport.y });
  }

  export function placementViewport() {
    const area = visibleCanvasArea(), viewport = getViewport();
    return { x: (area.x - viewport.x) / viewport.zoom, y: (area.y - viewport.y) / viewport.zoom,
      width: area.width / viewport.zoom, height: area.height / viewport.zoom };
  }

  export async function reveal(ids: string | string[], centerVisible = false) {
    const requested = typeof ids === "string" ? [ids] : ids;
    if (!requested.length) return;
    const generation = ++revealGeneration;
    cancelReveal?.();
    const cancelled = new Promise<void>(resolve => { cancelReveal = resolve; });
    // Stop an older pan at its current position before measuring the next target.
    if (revealing) void setViewport(getViewport(), { duration: 0 });
    revealing = true;
    try {
      if (!await waitForLayout()) return;
      for (let frame = 0; frame < 60; frame += 1) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!alive || !active || generation !== revealGeneration) return;
        const measured = requested.map(getInternalNode);
        if (!canvas?.clientWidth || !canvas.clientHeight || !measured.every(node => node?.measured.width && node.measured.height)) continue;
        const left = Math.min(...measured.map(node => node!.internals.positionAbsolute.x));
        const top = Math.min(...measured.map(node => node!.internals.positionAbsolute.y));
        const right = Math.max(...measured.map(node => node!.internals.positionAbsolute.x + node!.measured.width!));
        const bottom = Math.max(...measured.map(node => node!.internals.positionAbsolute.y + node!.measured.height!));
        const padding = 24;
        const bounds = canvas.getBoundingClientRect();
        const toolbar = canvas.querySelector(".workflow-toolbar")?.getBoundingClientRect();
        const insetTop = Math.max(padding, (toolbar?.bottom ?? bounds.top) - bounds.top + padding);
        const area = centerVisible ? visibleCanvasArea() : { x: padding, y: insetTop,
          width: Math.max(1, canvas.clientWidth - padding * 2), height: Math.max(1, canvas.clientHeight - insetTop - padding) };
        const { width, height } = area;
        const zoom = Math.max(store.minZoom, Math.min(getViewport().zoom, width / (right - left), height / (bottom - top)));
        const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;
        await Promise.race([cancelled, setViewport({ x: area.x + width / 2 - (left + right) / 2 * zoom,
          y: area.y + height / 2 - (top + bottom) / 2 * zoom, zoom }, { duration, interpolate: "linear" })]);
        return;
      }
    } finally {
      if (generation === revealGeneration) { revealing = false; cancelReveal = undefined; }
    }
  }
</script>

{#if Object.values(buttons).some(Boolean)}
<Controls position="top-right" orientation="horizontal" class="workflow-toolbar" showLock={false} showZoom={false} showFitView={false}>
  {#snippet before()}
    {#if toolbarButtonGroups[0].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
    {#if buttons.browse}<HintButton class="svelte-flow__controls-button" aria-label="Browse operations" label="Browse operations" aria-pressed={navigationOpen} aria-controls="side-navigation" onclick={onbrowse}><MaterialIcon name="list" size={18} /></HintButton>{/if}
    {#if buttons.switch}<HintButton class="svelte-flow__controls-button" aria-label="Switch" label="Switch" onclick={() => onutility("switch")}><MaterialIcon name="alt_route" size={18} /></HintButton>{/if}
    {#if buttons.cast}<HintButton class="svelte-flow__controls-button" aria-label="Cast" label="Cast type" onclick={() => onutility("cast")}><MaterialIcon name="settings_input_antenna" size={18} /></HintButton>{/if}
    {#if buttons.transform}<HintButton class="svelte-flow__controls-button" aria-label="Transform" label="Transform" onclick={() => onutility("transform")}><MaterialIcon name="transform" size={18} /></HintButton>{/if}
    {#if buttons.filter}<HintButton class="svelte-flow__controls-button" aria-label="Filter" label="Filter" onclick={() => onutility("filter")}><MaterialIcon name="filter_alt" size={18} /></HintButton>{/if}
    {#if buttons.assert}<HintButton class="svelte-flow__controls-button" aria-label="Assert" label="Assert" onclick={() => onutility("assert")}><MaterialIcon name="fact_check" size={18} /></HintButton>{/if}
    {#if buttons.stop}<HintButton class="svelte-flow__controls-button" aria-label="Stop" label="Stop" onclick={() => onutility("stop")}><MaterialIcon name="stop_circle" size={18} /></HintButton>{/if}
    {#if buttons.vault}<HintButton class="svelte-flow__controls-button" aria-label="Add vault variable" label="Add vault variable" onclick={() => onutility("vault")}><MaterialIcon name="variable_add" size={18} /></HintButton>{/if}
    {#if buttons.file}<HintButton class="svelte-flow__controls-button" aria-label="Add file" label="Add file" onclick={() => onutility("file")}><MaterialIcon name="upload_file" size={18} /></HintButton>{/if}
    {#if buttons.comment}<HintButton class="svelte-flow__controls-button" aria-label="Comment" label="Comment" onclick={() => onutility("comment")}><MaterialIcon name="sticky_note" size={18} /></HintButton>{/if}
    </div>
    {/if}
    {#if toolbarButtonGroups[1].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
    {#if buttons.copy}<HintButton class="svelte-flow__controls-button" aria-label="Copy selection" label="Copy selection" disabled={!selected} onclick={oncopy}><MaterialIcon name="content_copy" size={18} /></HintButton>{/if}
    {#if buttons.cut}<HintButton class="svelte-flow__controls-button" aria-label="Cut selection" label="Cut selection" disabled={!selected} onclick={oncut}><MaterialIcon name="content_cut" size={18} /></HintButton>{/if}
    {#if buttons.paste}<HintButton class="svelte-flow__controls-button" aria-label="Paste" label="Paste" disabled={!canPaste} onclick={onpaste}><MaterialIcon name="content_paste" size={18} /></HintButton>{/if}
    {#if buttons.delete}<HintButton class="svelte-flow__controls-button" aria-label="Remove selected" label="Remove selected" disabled={!selected} onclick={onremove}><MaterialIcon name="delete" size={18} /></HintButton>{/if}
    </div>
    {/if}
    {#if toolbarButtonGroups[2].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
    {#if buttons.dashed}<HintButton class="svelte-flow__controls-button" aria-label="Dashed connections" label="Dashed connections" aria-pressed={dashed} onclick={ondashed}><MaterialIcon name="unknown_med" size={18} /></HintButton>{/if}
    {#if buttons.curved}<HintButton class="svelte-flow__controls-button" aria-label="Connection style" label={`Connection style: ${workflowLineStyleLabels[lineStyle]}`} data-line-style={lineStyle} aria-pressed={curved} onclick={oncurved}><MaterialIcon name="line_curve" size={18} /></HintButton>{/if}
    {#if buttons.snap}<HintButton class="svelte-flow__controls-button" aria-label="Snap to grid" label="Snap to grid" aria-pressed={snap} onclick={onsnap}><MaterialIcon name="grid_on" size={18} /></HintButton>{/if}
    </div>
    {/if}
    {#if toolbarButtonGroups[3].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
    {#if buttons.zoomIn}<HintButton class="svelte-flow__controls-button" aria-label={ariaLabels["controls.zoomIn.ariaLabel"]} label={ariaLabels["controls.zoomIn.ariaLabel"]}
      disabled={maxZoomReached} onclick={() => { void zoomIn(); }}><MaterialIcon name="add" size={18} /></HintButton>{/if}
    {#if buttons.zoomOut}<HintButton class="svelte-flow__controls-button" aria-label={ariaLabels["controls.zoomOut.ariaLabel"]} label={ariaLabels["controls.zoomOut.ariaLabel"]}
      disabled={minZoomReached} onclick={() => { void zoomOut(); }}><MaterialIcon name="remove" size={18} /></HintButton>{/if}
    {#if buttons.fit}<HintButton class="svelte-flow__controls-button" aria-label={ariaLabels["controls.fitView.ariaLabel"]} label={ariaLabels["controls.fitView.ariaLabel"]}
      onclick={() => { void fitVisibleCanvas(); }}><MaterialIcon name="fit_screen" size={18} /></HintButton>{/if}
    </div>
    {/if}
  {/snippet}
  {#snippet after()}
    {#if toolbarButtonGroups[4].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
      {#if buttons.undo}<HintButton class="svelte-flow__controls-button" aria-label="Undo" label="Undo" disabled={!canUndo || historyBusy} onclick={onundo}><MaterialIcon name="undo" size={18} /></HintButton>{/if}
      {#if buttons.redo}<HintButton class="svelte-flow__controls-button" aria-label="Redo" label="Redo" disabled={!canRedo || historyBusy} onclick={onredo}><MaterialIcon name="redo" size={18} /></HintButton>{/if}
      {#if buttons.history}<HintButton class="svelte-flow__controls-button" aria-label="Workflow history" label="Workflow history" onclick={onhistory}><MaterialIcon name="history" size={18} /></HintButton>{/if}
    </div>
    {/if}
    {#if toolbarButtonGroups[5].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
    {#if buttons.new}<HintButton class="svelte-flow__controls-button" aria-label="New workflow" label="New workflow" onclick={onnew}><MaterialIcon name="flowsheet" size={18} /></HintButton>{/if}
    {#if buttons.open}<HintButton class="svelte-flow__controls-button" aria-label="Open workflow" label="Open workflow" onclick={onopen}><MaterialIcon name="folder_open" size={18} /></HintButton>{/if}
    {#if buttons.details}<HintButton class="svelte-flow__controls-button" aria-label="Workflow details" label="Workflow details" onclick={ondescribe}><MaterialIcon name="article" size={18} /></HintButton>{/if}
    {#if buttons.import}<HintButton class="svelte-flow__controls-button" aria-label="Import workflow" label="Import workflow" onclick={onimport}><MaterialIcon name="upload" size={18} /></HintButton>{/if}
    {#if buttons.export}<HintButton class="svelte-flow__controls-button" aria-label="Export workflow" label="Export workflow" onclick={onexport}><MaterialIcon name="download" size={18} /></HintButton>{/if}
    </div>
    {/if}
    {#if toolbarButtonGroups[6].buttons.some(key => buttons[key])}
    <div class="workflow-control-group">
      {#if buttons.run}<HintButton class="svelte-flow__controls-button" aria-label="Run workflow" label="Run workflow" disabled={!canRun} onclick={onrun}><MaterialIcon name="play_arrow" size={18} /></HintButton>{/if}
    </div>
    {/if}
  {/snippet}
</Controls>
{/if}

<style>
  .workflow-control-group { display: flex; flex: 0 0 auto; gap: 1px; }
  .workflow-control-group :global(button:first-child) { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
  .workflow-control-group :global(button:last-child) { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
  :global(.workflow-toolbar) { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: flex-end; max-width: calc(100% - 2rem); gap: 6px; margin: 0 1rem 1rem; padding: 3px; border: 2px solid var(--color-background); border-radius: 4px; background: var(--color-surface); box-shadow: none; }
  :global(.workflow-toolbar .svelte-flow__controls-button) { width: 30px; height: 30px; padding: 6px; border: 0; border-radius: 0; background: var(--color-background); color: var(--color-foreground); transition: color 180ms ease-in, background-color 180ms ease-in, opacity 180ms ease-in, outline-color 180ms ease-in; }
  :global(.workflow-toolbar.svelte-flow__controls.horizontal .svelte-flow__controls-button) { border: 0; }
  :global(.workflow-toolbar .svelte-flow__controls-button:focus-visible) { position: relative; z-index: 1; }
  :global(.workflow-toolbar .svelte-flow__controls-button:is(:hover,:focus-visible):not(:disabled):not([aria-pressed="true"])) { color: var(--color-secondary-hover-foreground); background: var(--color-secondary-hover); }
  :global(.workflow-toolbar .svelte-flow__controls-button[aria-pressed="true"]) { background: var(--color-catalog-active); color: var(--color-catalog-active-foreground); }
  :global(.workflow-toolbar .svelte-flow__controls-button:disabled) { pointer-events: auto; background: var(--color-background); color: var(--color-disabled-foreground); }
  :global(.workflow-toolbar .material-symbols-rounded) { transition: transform 180ms ease-in; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    :global(.workflow-toolbar button:not(:disabled):not([inert] *) .material-symbols-rounded) { will-change: transform; }
    :global(.workflow-toolbar button:hover:not(:disabled):not([inert] *) .material-symbols-rounded) { transform: scale(1.10); }
  }
</style>
