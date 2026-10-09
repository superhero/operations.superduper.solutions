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
  let { open = false, onToggle, summary, children, class: className = "", label, groupLabel, hint, tooltipEnabled = true }:
    { open?: boolean; onToggle: (next: boolean) => void; summary: Snippet; children: Snippet; class?: string; label?: string; groupLabel?: string; hint?: string; tooltipEnabled?: boolean } = $props();
  const id = $props.id();
  let panel: HTMLDivElement;
  let heading: HTMLElement;
  let nestedHover = $state(false);
  let nestedFocus = $state(false);
  let expanded = $state(untrack(() => open));
  let ready = $state(false);
  let reduced = $state(true);
  let animation: Animation | undefined;
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
  $effect.pre(() => {
    const next = open;
    if (!ready || next === previous) return;
    previous = next;
    // Nested content must be free to grow beyond an ancestor's cached endpoint.
    parent?.settleAncestors();
    const revision = ++transition;
    const height = panel.getBoundingClientRect().height;
    animation?.cancel();
    animation = undefined;
    for (const child of childrenToSettle) child();
    if (!next && panel.contains(document.activeElement)) heading.focus({ preventScroll: true });
    expanded = true;
    void tick().then(() => {
      if (revision !== transition || next !== open) return;
      if (reduced) { expanded = next; return; }
      const current = panel.animate([{height: `${height}px`, overflow: "visible clip"}, {height: `${next ? panel.scrollHeight : 0}px`, overflow: "visible clip"}], {duration: 240, easing: "ease-in", fill: "both"});
      animation = current;
      current.onfinish = () => { if (animation === current) { expanded = open; animation = undefined; current.cancel(); } };
    });
  });
</script>

<details class={className} open={expanded || open} aria-label={groupLabel}>
  <HintButton label={hint ?? `${open ? "Hide" : "Show"} ${label ?? "details"}`} {tooltipEnabled} disabled={nestedHover || nestedFocus}>
    {#snippet child({ props })}
      {@const { type: _type, disabled: _disabled, ...triggerProps } = props}
      <summary {...triggerProps} bind:this={heading} aria-label={label} aria-expanded={open} aria-controls={id}
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
  </HintButton>
  <div bind:this={panel} id={id} class="disclosure-panel" inert={!open} aria-hidden={!open} hidden={!expanded && !open}>
    {@render children()}
  </div>
</details>
