<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { Popover } from "bits-ui";
  let { label, width, minimum, maximum, defaultWidth, edge = "left", onresize, oncommit, onresizing, onclose }: {
    label: string; width: number; minimum: number; maximum: number; defaultWidth: number; edge?: "left" | "right";
    onresize: (width: number) => void; oncommit: () => void; onresizing: (active: boolean) => void; onclose: () => void;
  } = $props();
  let drag = $state<{ x: number; width: number; pointer: number; moved: boolean } | null>(null);
  let open = $state(false);
  let handle = $state<HTMLDivElement>();
  let controls = $state<HTMLDivElement | null>(null);
  let suppressClick = false;
  const uid = $props.id();
  const controlsId = `${uid}-sizes`;
  onDestroy(() => { if (drag) onresizing(false); });
  function resize(value: number) { onresize(Math.round(Math.max(minimum, Math.min(maximum, value)))); }
  function choose(value: number) { resize(value); oncommit(); open = false; }
  function start(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    // Touch uses touch-action; cancelling pointerdown suppresses Safari taps.
    if (event.pointerType === "mouse") event.preventDefault();
    open = false; suppressClick = false;
    drag = { x: event.clientX, width, pointer: event.pointerId, moved: false };
    onresizing(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function finish(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return;
    suppressClick = drag.moved || event.type !== "pointerup";
    drag = null; onresizing(false); oncommit();
  }
  function toggleControls(event: MouseEvent) {
    if (event.detail > 0 && suppressClick) { suppressClick = false; return; }
    handle?.focus({ preventScroll: true }); open = !open;
  }
  function key(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); handle?.focus(); open = !open; return; }
    const delta = (event.shiftKey ? 64 : 16) * (edge === "left" ? -1 : 1);
    const value = event.key === "ArrowRight" ? width + delta : event.key === "ArrowLeft" ? width - delta
      : event.key === "Home" ? minimum : event.key === "End" ? maximum : undefined;
    if (value === undefined) return;
    event.preventDefault(); event.stopPropagation(); resize(value); oncommit();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable ARIA window splitter with arrow-key resizing and tap-accessible size controls.) -->
<div bind:this={handle} class="pane-resize" class:dragging={drag !== null} data-edge={edge} role="separator" tabindex="0"
  aria-label={label} aria-describedby={uid} aria-controls={open ? controlsId : undefined} aria-orientation="vertical"
  aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width} pixels`}
  onpointerdown={start} onpointermove={event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (Math.abs(event.clientX - drag.x) >= 6) drag.moved = true;
    if (drag.moved) resize(drag.width + (event.clientX - drag.x) * (edge === "left" ? -1 : 1));
  }} onpointerup={finish} onpointercancel={finish} onlostpointercapture={finish} onkeydown={key}
  onclick={toggleControls} ondblclick={() => choose(defaultWidth)}></div>

<span class="sr-only" id={uid}>Drag or use arrow keys to resize. Tap or press Enter for size options and closing.</span>

<Popover.Root bind:open>
  <Popover.Portal>
    <Popover.Content id={controlsId} bind:ref={controls} customAnchor={handle ?? null} side={edge === "left" ? "right" : "left"}
      sideOffset={6} align="center" class="pane-size-options" role="dialog" aria-label={`${label} controls`}
      onOpenAutoFocus={event => { event.preventDefault(); void tick().then(() => controls?.querySelector<HTMLButtonElement>("button")?.focus()); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (handle?.isConnected) handle?.focus({ preventScroll: true }); }}>
      <button type="button" onclick={() => choose(minimum)}>Narrow</button>
      <button type="button" onclick={() => choose((minimum + maximum) / 2)}>Medium</button>
      <button type="button" onclick={() => choose(maximum)}>Wide</button>
      <button type="button" onclick={() => choose(defaultWidth)}>Reset width</button>
      <button type="button" onclick={() => { open = false; onclose(); }}>Close pane</button>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  .pane-resize { position: absolute; z-index: 30; top: 0; bottom: 0; width: 10px; cursor: ew-resize; touch-action: none; pointer-events: auto; }
  .pane-resize[data-edge="left"] { left: 0; }
  .pane-resize[data-edge="right"] { right: 0; }
  .pane-resize::after { content: ""; position: absolute; top: 0; bottom: 0; width: 2px; background: var(--color-emphasis); opacity: 0; transition: opacity 180ms ease-out; }
  .pane-resize[data-edge="left"]::after { left: 0; }
  .pane-resize[data-edge="right"]::after { right: 0; }
  .pane-resize:hover::after { opacity: 1; transition-delay: 200ms; }
  .pane-resize:focus-visible::after, .pane-resize.dragging::after { opacity: 1; transition-delay: 0s; }
  .pane-resize:focus-visible { outline: 2px solid var(--color-emphasis); outline-offset: -2px; }
  :global(.pane-size-options) { z-index: 120; min-width: 160px; padding: 6px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-foreground); box-shadow: 0 4px 16px #0003; }
  :global(.pane-size-options button) { display: block; width: 100%; min-height: 44px; padding: 8px 12px; border-radius: 4px; text-align: left; background: transparent; color: inherit; }
  :global(.pane-size-options button:hover), :global(.pane-size-options button:focus-visible) { background: var(--color-background); }
  @media (any-pointer: coarse) {
    .pane-resize { width: 44px; height: 96px; top: calc(50% - 48px); bottom: auto; }
    .pane-resize::before { content: ""; position: absolute; top: 24px; bottom: 24px; width: 4px; border-radius: 4px; background: var(--color-foreground); opacity: 0.55; }
    .pane-resize[data-edge="left"]::before { left: 5px; }
    .pane-resize[data-edge="right"]::before { right: 5px; }
    .pane-resize:hover::after { transition-delay: 0s; }
  }
  @media (prefers-reduced-motion: reduce) { .pane-resize::after { transition: none; } }
</style>
