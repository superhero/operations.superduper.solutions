<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { MiniMap, useSvelteFlow, useStore } from "@xyflow/svelte";

  let { active = true }: { active?: boolean } = $props();
  const store = useStore();
  const { getViewport, setViewport, zoomIn, zoomOut, fitView } = useSvelteFlow();
  const instructionsId = $props.id();
  const width = $derived(store.width < 480 ? 120 : 180);
  const height = $derived(width * 2 / 3);

  function navigate(event: KeyboardEvent) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!active || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const viewport = getViewport();
    switch (event.key) {
      case "ArrowLeft": void setViewport({ ...viewport, x: viewport.x + 40 }, { duration: 0 }); break;
      case "ArrowRight": void setViewport({ ...viewport, x: viewport.x - 40 }, { duration: 0 }); break;
      case "ArrowUp": void setViewport({ ...viewport, y: viewport.y + 40 }, { duration: 0 }); break;
      case "ArrowDown": void setViewport({ ...viewport, y: viewport.y - 40 }, { duration: 0 }); break;
      case "+": case "=": void zoomIn({ duration: 0 }); break;
      case "-": void zoomOut({ duration: 0 }); break;
      case "Home": void fitView({ padding: 0.2, maxZoom: 1, duration: 0 }); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<MiniMap class="workflow-minimap" position="bottom-right" {width} {height}
  role="group" aria-label="Workflow minimap" aria-describedby={instructionsId}
  ariaLabel="Operations and current viewport" tabindex={active ? 0 : -1}
  aria-disabled={!active} pannable={active} zoomable={active} onkeydown={navigate}
  nodeBorderRadius={4} nodeStrokeWidth={0}
  bgColor="var(--color-surface)"
  nodeColor={node => node.selected ? "var(--color-emphasis)" : "var(--color-graph-line)"}
  maskColor="color-mix(in srgb, var(--color-background) 65%, transparent)"
  maskStrokeWidth={0} />
<span id={instructionsId} class="sr-only">Arrow keys pan. Plus and minus zoom. Home fits all operations.</span>

<style>
  :global(.workflow-minimap) { margin: 0 1rem 2rem; border: 1px solid var(--color-border); border-radius: 4px; overflow: hidden; }
  :global(.workflow-minimap:focus-visible) { outline: 2px solid var(--color-emphasis); outline-offset: 3px; }
  :global(.workflow-minimap .svelte-flow__minimap-svg) { display: block; cursor: grab; }
  :global(.workflow-minimap .svelte-flow__minimap-svg:active) { cursor: grabbing; }
  :global(.workflow-minimap[aria-disabled="true"]) { pointer-events: none; }
  @media (prefers-reduced-motion: no-preference) {
    :global(.workflow-minimap .svelte-flow__minimap-node) { transition: fill 180ms ease-in; }
  }
</style>
