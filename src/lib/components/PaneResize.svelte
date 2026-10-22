<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  let { label, width, minimum, maximum, defaultWidth, edge = "left", onresize, oncommit, onresizing }: {
    label: string; width: number; minimum: number; maximum: number; defaultWidth: number; edge?: "left" | "right";
    onresize: (width: number) => void; oncommit: () => void; onresizing: (active: boolean) => void;
  } = $props();
  let drag = $state<{ x: number; width: number } | null>(null);
  onDestroy(() => { if (drag) onresizing(false); });
  function resize(value: number) { onresize(Math.round(Math.max(minimum, Math.min(maximum, value)))); }
  function start(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, width };
    onresizing(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function finish() {
    if (!drag) return;
    drag = null;
    onresizing(false);
    oncommit();
  }
  function key(event: KeyboardEvent) {
    const delta = (event.shiftKey ? 64 : 16) * (edge === "left" ? -1 : 1);
    const value = event.key === "ArrowRight" ? width + delta : event.key === "ArrowLeft" ? width - delta
      : event.key === "Home" ? minimum : event.key === "End" ? maximum : undefined;
    if (value === undefined) return;
    event.preventDefault(); event.stopPropagation();
    resize(value); oncommit();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable ARIA window splitter with arrow-key resizing.) -->
<div class="pane-resize" class:dragging={drag !== null} data-edge={edge} role="separator" tabindex="0"
  aria-label={label} aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum}
  aria-valuenow={width} aria-valuetext={`${width} pixels`}
  onpointerdown={start} onpointermove={event => { if (drag) resize(drag.width + (event.clientX - drag.x) * (edge === "left" ? -1 : 1)); }}
  onpointerup={finish} onpointercancel={finish} onlostpointercapture={finish} onkeydown={key}
  ondblclick={() => { resize(defaultWidth); oncommit(); }}></div>

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
  @media (prefers-reduced-motion: reduce) { .pane-resize::after { transition: none; } }
</style>
