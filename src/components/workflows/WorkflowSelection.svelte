<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { useStore } from "@xyflow/svelte";

  let { canvas, active }: { canvas: HTMLElement | undefined; active: boolean } = $props();
  const store = useStore();
  let additive = $state.raw<{ nodes: Set<string>; edges: Set<string> } | null>(null);

  function retainSelection() {
    if (!additive) return;
    const { nodes, edges } = additive;
    if (store.nodes.some(node => nodes.has(node.id) && !node.selected))
      store.nodes = store.nodes.map(node => nodes.has(node.id) && !node.selected ? { ...node, selected: true } : node);
    if (store.edges.some(edge => edges.has(edge.id) && !edge.selected))
      store.edges = store.edges.map(edge => edges.has(edge.id) && !edge.selected ? { ...edge, selected: true } : edge);
  }

  $effect(() => {
    if (active && additive && store.selectionRectMode === "user") retainSelection();
  });

  $effect(() => {
    // Keep the live drag rectangle, but no group overlay after release.
    if (active && store.selectionRectMode === "nodes") store.selectionRectMode = null;
  });

  $effect(() => {
    if (!canvas || !active) return;
    const element = canvas;
    let rectangleCompleted = false;
    function clearSelection() {
      additive = null;
      store.unselectNodesAndEdges();
      store.selectionRect = null;
      store.selectionRectMode = null;
      const focused = document.activeElement;
      if ((focused instanceof HTMLElement || focused instanceof SVGElement) && element.contains(focused) &&
        focused.matches(".svelte-flow__node, .svelte-flow__edge, .svelte-flow__selection-wrapper")) focused.blur();
    }
    function select(event: MouseEvent) {
      if (event.type === "pointerdown") { additive = null; rectangleCompleted = false; }
      // Let the pane consume its drag-ending click before considering gap clicks.
      if (event.type === "click" && rectangleCompleted) { rectangleCompleted = false; return; }
      if (event.button !== 0 || !(event.target instanceof Element) ||
        event.target.closest("button, a, input, textarea, select, [contenteditable], .nokey, .svelte-flow__handle")) return;
      let wrapper = event.target.closest<HTMLElement>(".svelte-flow__node");
      // A box selection's drag overlay can cover the individual nodes beneath it.
      const overlay = event.target.closest(".svelte-flow__selection-wrapper");
      if (!wrapper && overlay)
        wrapper = document.elementsFromPoint(event.clientX, event.clientY)
          .map(item => item.closest<HTMLElement>(".svelte-flow__node")).find(Boolean) ?? null;
      if (event.type === "pointerdown" && event.shiftKey && !wrapper &&
        (overlay || event.target.matches(".svelte-flow__pane"))) {
        additive = {
          nodes: new Set(store.nodes.filter(node => node.selected).map(node => node.id)),
          edges: new Set(store.edges.filter(edge => edge.selected).map(edge => edge.id))
        };
      }
      if (!wrapper && overlay && event.type === "click") {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearSelection();
        return;
      }
      if (!event.shiftKey) return;
      const node = store.nodes.find(node => node.id === wrapper?.dataset.id);
      if (!node || node.hidden || node.selectable === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "click") return;
      store.selectionRect = null;
      store.selectionRectMode = null;
      store.nodes = store.nodes.map(item => item.id === node.id ? { ...item, selected: !item.selected } : item);
      if (node.selected) store.edges = store.edges.map(edge => edge.selected && (edge.source === node.id || edge.target === node.id)
        ? { ...edge, selected: false } : edge);
      if (node.selected && wrapper?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }
    function finishRectangle() {
      if (additive && store.selectionRectMode === "user") {
        retainSelection();
        rectangleCompleted = true;
      }
      additive = null;
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || store.connection.inProgress || !(event.target instanceof Element) ||
        event.target.closest("input, textarea, select, [contenteditable], .nokey") ||
        event.target !== document.body && !element.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearSelection();
    }
    // Handle node clicks before the pane starts a Shift-drag selection rectangle.
    const events = ["pointerdown", "mousedown", "click", "dblclick"] as const;
    for (const type of events) element.addEventListener(type, select, true);
    window.addEventListener("pointerup", finishRectangle, true);
    window.addEventListener("pointercancel", finishRectangle, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      for (const type of events) element.removeEventListener(type, select, true);
      window.removeEventListener("pointerup", finishRectangle, true);
      window.removeEventListener("pointercancel", finishRectangle, true);
      window.removeEventListener("keydown", escape, true);
      additive = null;
    };
  });
</script>
