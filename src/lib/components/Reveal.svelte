<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from "svelte";
  let { open, id, children }: { open: boolean; id: string; children: Snippet } = $props();
  let reduced = $state(true);
  let ready = false;
  let rendered = $state(untrack(() => open));
  let visible = $state(untrack(() => open));
  let panel = $state<HTMLDivElement>();
  let revision = 0;
  let previous = untrack(() => open);

  onMount(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reduced = media.matches;
      if (reduced) { revision += 1; visible = open; rendered = open; }
    };
    update(); ready = true;
    media.addEventListener("change", update);
    return () => { revision += 1; media.removeEventListener("change", update); };
  });

  $effect.pre(() => {
    const next = open;
    if (next === previous) return;
    previous = next;
    const current = ++revision;
    if (!ready || reduced) { visible = next; rendered = next; return; }
    rendered = true;
    void (async () => {
      await tick();
      if (current !== revision || !panel) return;
      // Establish the collapsed grid before opening; CSS reverses from its current size.
      panel.getBoundingClientRect();
      visible = next;
      await tick();
      if (current !== revision || !panel) return;
      await Promise.allSettled(panel.getAnimations().map(animation => animation.finished));
      if (current === revision) rendered = next;
    })();
  });
</script>

<div bind:this={panel} {id} class="reveal-panel" class:is-open={visible} inert={!open} aria-hidden={!open} hidden={!rendered && !open}>
  <div class="reveal-panel-inner">
    {#if rendered}{@render children()}{/if}
  </div>
</div>

<style>
  .reveal-panel { display: grid; grid-template-rows: 0fr; visibility: hidden; transition: grid-template-rows 240ms ease-in, visibility 0s linear 240ms; }
  .reveal-panel.is-open { grid-template-rows: 1fr; visibility: visible; transition-delay: 0s; }
  .reveal-panel-inner { min-width: 0; min-height: 0; overflow: clip; }
  @media (prefers-reduced-motion: reduce) { .reveal-panel { transition: none; } }
</style>
