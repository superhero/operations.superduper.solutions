<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  let { label, direction, panel, onclose, onmove }: {
    label: string; direction: "left" | "right"; panel: string; onclose: () => void;
    onmove: (offset: number, active: boolean) => void;
  } = $props();
  let drag: { pointer: number; x: number; y: number; time: number; moved: boolean; blocked: boolean; distance: number; threshold: number } | null = null;
  let suppressClick = false;
  let pendingClose = 0;
  const descriptionId = $props.id();
  onDestroy(() => { cancelAnimationFrame(pendingClose); if (drag) onmove(0, false); });
  function start(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || drag || pendingClose) return;
    suppressClick = false;
    const width = document.querySelector(panel)?.getBoundingClientRect().width ?? window.innerWidth;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), moved: false, blocked: false, distance: 0, threshold: Math.min(120, width / 4) };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId || drag.blocked) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    if (!drag.moved && Math.abs(dy) > Math.abs(dx)) { drag.blocked = true; return; }
    drag.moved = true;
    drag.distance = Math.max(0, dx * (direction === "left" ? -1 : 1));
    onmove(drag.distance * (direction === "left" ? -1 : 1), true);
  }
  function finish(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const elapsed = Math.max(1, performance.now() - drag.time);
    const close = event.type === "pointerup" && !drag.blocked &&
      (drag.distance >= drag.threshold || drag.distance >= 32 && drag.distance / elapsed >= 0.55);
    suppressClick = drag.moved || drag.blocked || event.type !== "pointerup";
    const offset = drag.distance * (direction === "left" ? -1 : 1);
    drag = null;
    if (close) {
      // Consume the compatibility click before moving the pane off its target.
      onmove(offset, false);
      pendingClose = requestAnimationFrame(() => { pendingClose = 0; onclose(); onmove(0, false); });
    } else onmove(0, false);
  }
</script>

<button type="button" class="pane-dismiss" aria-label={label} aria-describedby={descriptionId}
  onpointerdown={start} onpointermove={move} onpointerup={finish} onpointercancel={finish} onlostpointercapture={finish}
  onclick={event => { if (pendingClose || event.detail > 0 && suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; return; } onclose(); }}>
  <span class="sr-only" id={descriptionId}>Swipe {direction} or tap to close</span>
  <span class="grip" aria-hidden="true"></span>
  <span class="hint" aria-hidden="true">{direction === "left" ? "‹" : "›"} Swipe {direction} to close</span>
</button>

<style>
  .pane-dismiss { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 48px; width: min(240px, 100%); padding: 6px 16px; background: transparent; color: var(--color-foreground); touch-action: none; user-select: none; }
  .grip { width: 44px; height: 4px; border-radius: 4px; background: currentColor; opacity: 0.6; }
  .hint { font-size: 11px; opacity: 0.8; }
  .pane-dismiss:focus-visible { outline: 2px solid var(--color-emphasis); outline-offset: -2px; border-radius: 4px; }
</style>
