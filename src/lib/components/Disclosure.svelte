<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script module lang="ts">
  const disclosureContext = Symbol("disclosure");
  type DisclosureContext = { settleAncestors: () => void; children: Set<() => void> };
</script>

<script lang="ts">
  import { getContext, onMount, setContext, tick, untrack, type Snippet } from "svelte";
  import HintButton from "./HintButton.svelte";
  let { open = false, onToggle, onClosed, summary, children, class: className = "", label, groupLabel, hint, tooltipEnabled = true, lazy = false, animateSize = false }:
    { open?: boolean; onToggle: (next: boolean) => void; onClosed?: () => void; summary: Snippet; children: Snippet; class?: string; label?: string; groupLabel?: string; hint?: string; tooltipEnabled?: boolean; lazy?: boolean; animateSize?: boolean } = $props();
  const id = $props.id();
  let panel: HTMLDivElement;
  let content = $state<HTMLDivElement>();
  let heading: HTMLElement;
  let nestedHover = $state(false);
  let nestedFocus = $state(false);
  let expanded = $state(untrack(() => open));
  let ready = $state(false);
  let reduced = $state(true);
  let animation: Animation | undefined;
  let targetHeight = 0;
  let transition = 0;
  let previous = untrack(() => open);
  const parent = getContext<DisclosureContext | undefined>(disclosureContext);
  const childrenToSettle = new Set<() => void>();
  function isNestedControl(target: EventTarget | null) {
    return target instanceof Element && target !== heading && heading.contains(target)
      && Boolean(target.closest("button, a, input, select, textarea, [role='button']"));
  }
  function settle() {
    transition += 1;
    animation?.cancel();
    animation = undefined;
    expanded = open;
    if (!open) onClosed?.();
    if (animateSize && panel) {
      targetHeight = open ? content?.offsetHeight ?? 0 : 0;
      panel.style.height = `${targetHeight}px`;
    }
  }
  function animateHeight(from: number, to: number) {
    targetHeight = to;
    animation?.cancel();
    if (animateSize) panel.style.height = `${to}px`;
    const current = panel.animate([{ height: `${from}px`, overflow: "visible clip" }, { height: `${to}px`, overflow: "visible clip" }], { duration: 240, easing: "ease-in-out", fill: "both" });
    animation = current;
    current.onfinish = () => { if (animation === current) { expanded = open; animation = undefined; current.cancel(); if (!open) onClosed?.(); } };
  }
  function settleTree() { settle(); for (const child of childrenToSettle) child(); }
  setContext<DisclosureContext>(disclosureContext, {
    settleAncestors: () => { if (open) settle(); parent?.settleAncestors(); },
    children: childrenToSettle,
  });
  onMount(() => {
    parent?.children.add(settleTree);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reduced = media.matches; if (reduced) settle(); };
    update(); ready = true;
    media.addEventListener("change", update);
    return () => { parent?.children.delete(settleTree); media.removeEventListener("change", update); animation?.cancel(); };
  });
  $effect(() => {
    if (!animateSize || !content) return;
    const observed = content;
    let frame = 0;
    // Observe natural content, not the animated panel. Keep its height pinned so
    // asynchronous reports cannot jump before the next animation frame.
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (!open || !content) return;
        // CSS heights use layout pixels; client rectangles include canvas zoom.
        const height = content.offsetHeight;
        if (height === targetHeight) return;
        if (reduced) settle();
        else animateHeight(panel.offsetHeight, height);
      });
    });
    observer.observe(observed);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  });
  $effect.pre(() => {
    const next = open;
    if (!ready || next === previous) return;
    previous = next;
    // Nested content must be free to grow beyond an ancestor's cached endpoint.
    parent?.settleAncestors();
    const revision = ++transition;
    const height = panel.offsetHeight;
    animation?.cancel();
    animation = undefined;
    for (const child of childrenToSettle) child();
    if (!next && panel.contains(document.activeElement)) heading.focus({ preventScroll: true });
    expanded = true;
    void tick().then(() => {
      if (revision !== transition || next !== open) return;
      if (reduced) { settle(); return; }
      animateHeight(height, next ? animateSize ? content?.offsetHeight ?? 0 : panel.scrollHeight : 0);
    });
  });
</script>

<details class={className} open={expanded || open} aria-label={groupLabel}>
  {#snippet trigger(triggerProps: Record<string, any>)}
      <summary {...triggerProps} bind:this={heading} tabindex={triggerProps.tabindex ?? 0} aria-label={label} aria-expanded={open} aria-controls={id}
        onpointerover={(event) => nestedHover = isNestedControl(event.target)}
        onpointerleave={(event) => { nestedHover = false; if (typeof triggerProps.onpointerleave === "function") triggerProps.onpointerleave(event); }}
        onfocusin={(event) => nestedFocus = isNestedControl(event.target)}
        onfocusout={(event) => nestedFocus = isNestedControl(event.relatedTarget)}
        onclick={(event) => {
          if (typeof triggerProps.onclick === "function") triggerProps.onclick(event);
          if (isNestedControl(event.target)) return;
          event.preventDefault(); onToggle(!open);
        }}>
        {@render summary()}
      </summary>
  {/snippet}
  {#if tooltipEnabled}
  <HintButton label={hint ?? `${open ? "Hide" : "Show"} ${label ?? "details"}`} disabled={nestedHover || nestedFocus}>
    {#snippet child({ props })}
      {@const { type: _type, disabled: _disabled, ...triggerProps } = props}
      {@render trigger(triggerProps)}
    {/snippet}
  </HintButton>
  {:else}
    {@render trigger({})}
  {/if}
  <div bind:this={panel} id={id} class="disclosure-panel" class:resizable={animateSize} inert={!open} aria-hidden={!open} hidden={!expanded && !open}>
    {#if animateSize}
      <div bind:this={content} class="disclosure-content">
        {#if !lazy || expanded || open}{@render children()}{/if}
      </div>
    {:else if !lazy || expanded || open}
      {@render children()}
    {/if}
  </div>
</details>

<style>
  .resizable { overflow: visible clip; }
  .disclosure-content { display: flow-root; }
</style>
