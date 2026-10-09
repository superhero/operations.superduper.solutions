<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount } from "svelte";

  onMount(() => {
    if (!CSS.supports("selector(::-webkit-scrollbar)") || !CSS.registerProperty) return;
    const selector = "html, .catalog-menu, .catalog-sheet, .modal-content, .json-scroll, textarea";
    const properties = { x: "--scrollbar-x-inset", y: "--scrollbar-y-inset" };
    type Hit = { element: HTMLElement; axis: keyof typeof properties };
    const animations = new Map<HTMLElement, Partial<Record<Hit["axis"], Animation>>>();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let hovered: Hit | null = null;
    let dragging = false;

    function hitTest(event: PointerEvent): Hit | null {
      for (const element of event.composedPath()) {
        if (!(element instanceof HTMLElement) || !element.matches(selector)) continue;
        const root = element === document.scrollingElement;
        const style = root ? null : getComputedStyle(element);
        const borderRight = style ? parseFloat(style.borderRightWidth) : 0;
        const borderBottom = style ? parseFloat(style.borderBottomWidth) : 0;
        const rect = root ? { top: 0, left: 0, right: innerWidth, bottom: innerHeight } : element.getBoundingClientRect();
        const right = rect.right - borderRight;
        const bottom = rect.bottom - borderBottom;
        const width = root ? innerWidth - element.clientWidth : element.offsetWidth - element.clientWidth - element.clientLeft - borderRight;
        const height = root ? innerHeight - element.clientHeight : element.offsetHeight - element.clientHeight - element.clientTop - borderBottom;
        const { clientX: x, clientY: y } = event;
        if (width > 0 && element.scrollHeight > element.clientHeight && x >= right - width && x < right && y >= rect.top && y < bottom - height)
          return { element, axis: "y" };
        if (height > 0 && element.scrollWidth > element.clientWidth && y >= bottom - height && y < bottom && x >= rect.left && x < right - width)
          return { element, axis: "x" };
      }
      return null;
    }

    function animate({ element, axis }: Hit, inset: number, delay = 0) {
      const property = properties[axis];
      const current = getComputedStyle(element).getPropertyValue(property);
      const axes = animations.get(element) ?? {};
      axes[axis]?.cancel();
      delete axes[axis];
      if (!Object.keys(axes).length) animations.delete(element);
      element.style.setProperty(property, `${inset}px`);
      if (reduced.matches || parseFloat(current) === inset || !element.isConnected) return;
      const animation = element.animate([{ [property]: current }, { [property]: `${inset}px` }], {
        duration: 200, delay, easing: "ease-in", fill: "both"
      });
      axes[axis] = animation;
      animations.set(element, axes);
      animation.onfinish = () => {
        animation.cancel();
        delete axes[axis];
        if (!Object.keys(axes).length) animations.delete(element);
      };
    }

    function hover(next: Hit | null) {
      if (hovered?.element === next?.element && hovered?.axis === next?.axis) return;
      if (hovered) animate(hovered, 4);
      hovered = next;
      if (hovered) animate(hovered, 0, 150);
    }
    const move = (event: PointerEvent) => {
      if (!event.buttons) dragging = false;
      if (!dragging && event.pointerType !== "touch") hover(hitTest(event));
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      hover(hitTest(event));
      dragging = Boolean(hovered);
    };
    const up = (event: PointerEvent) => { dragging = false; if (event.pointerType !== "touch") hover(hitTest(event)); };
    const out = (event: PointerEvent) => { if (!event.relatedTarget && !dragging) hover(null); };
    const reset = () => { dragging = false; hover(null); };
    const preference = () => {
      if (reduced.matches) for (const axes of animations.values()) for (const animation of Object.values(axes)) animation.finish();
    };
    const listeners = { pointermove: move, pointerdown: down, pointerup: up, pointerout: out, pointercancel: reset };
    document.documentElement.classList.add("animated-scrollbars");
    for (const [name, handler] of Object.entries(listeners)) document.addEventListener(name, handler as EventListener, { passive: true, capture: true });
    window.addEventListener("blur", reset);
    reduced.addEventListener("change", preference);
    return () => {
      for (const [name, handler] of Object.entries(listeners)) document.removeEventListener(name, handler as EventListener, true);
      window.removeEventListener("blur", reset);
      reduced.removeEventListener("change", preference);
      for (const axes of animations.values()) for (const animation of Object.values(axes)) animation.cancel();
      document.documentElement.classList.remove("animated-scrollbars");
      for (const element of document.querySelectorAll<HTMLElement>(selector)) for (const property of Object.values(properties)) element.style.removeProperty(property);
    };
  });
</script>

<style>
  @property --scrollbar-x-inset { syntax: "<length>"; inherits: true; initial-value: 4px; }
  @property --scrollbar-y-inset { syntax: "<length>"; inherits: true; initial-value: 4px; }
  :global(*) { scrollbar-color: var(--color-scrollbar-thumb) transparent; }
  :global(:is(html, .catalog-menu, .catalog-sheet, .modal-content, .json-scroll, .json-report, textarea)) { scrollbar-gutter: stable; }
  :global(::-webkit-scrollbar) { width: 4px; height: 4px; }
  :global(::-webkit-scrollbar-track), :global(::-webkit-scrollbar-corner) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) { background: var(--color-scrollbar-thumb); border-radius: 4px; }
  :global(:root.animated-scrollbars), :global(.animated-scrollbars :is(.catalog-menu, .catalog-sheet, .modal-content, .json-scroll, textarea)) {
    scrollbar-width: auto; scrollbar-color: auto;
    --scrollbar-x-inset: 4px; --scrollbar-y-inset: 4px;
  }
  :global(:root.animated-scrollbars::-webkit-scrollbar), :global(.animated-scrollbars :is(.catalog-menu, .catalog-sheet, .modal-content, .json-scroll, textarea)::-webkit-scrollbar) { width: 8px; height: 8px; }
  :global(:root.animated-scrollbars::-webkit-scrollbar-thumb), :global(.animated-scrollbars :is(.catalog-menu, .catalog-sheet, .modal-content, .json-scroll, textarea)::-webkit-scrollbar-thumb) {
    --scrollbar-left-inset: var(--scrollbar-y-inset);
    --scrollbar-top-inset: var(--scrollbar-x-inset);
    --scrollbar-cap-radius: calc((8px - var(--scrollbar-left-inset) - var(--scrollbar-top-inset)) / 2);
    background-clip: padding-box; border: 0 solid transparent;
    border-left-width: var(--scrollbar-left-inset); border-top-width: var(--scrollbar-top-inset);
    border-radius: calc(var(--scrollbar-cap-radius) + var(--scrollbar-left-inset)) var(--scrollbar-cap-radius) var(--scrollbar-cap-radius) calc(var(--scrollbar-cap-radius) + var(--scrollbar-left-inset)) / calc(var(--scrollbar-cap-radius) + var(--scrollbar-top-inset)) calc(var(--scrollbar-cap-radius) + var(--scrollbar-top-inset)) var(--scrollbar-cap-radius) var(--scrollbar-cap-radius);
  }
  :global(::-webkit-scrollbar-thumb:vertical) { --scrollbar-top-inset: 0px !important; }
  :global(::-webkit-scrollbar-thumb:horizontal) { --scrollbar-left-inset: 0px !important; }
</style>
