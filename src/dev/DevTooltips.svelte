<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { flushSync, onMount } from "svelte";
  import { Tooltip } from "bits-ui";

  let anchor = $state<HTMLElement | null>(null);
  let label = $state("");
  let side = $state<"top" | "right">("top");
  let open = $state(false);

  onMount(() => {
    type Title = { text: string; marker: string | null; addedLabel?: string };
    const titles = new Map<HTMLElement, Title>();
    const roots = new Map<ShadowRoot, MutationObserver>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    function owner(element: Element): string | undefined {
      let root = element.getRootNode();
      while (root instanceof ShadowRoot && root.mode === "open") {
        if (["dev-toolbar", "vite-error-overlay"].includes(root.host.localName)) return root.host.localName;
        root = root.host.getRootNode();
      }
    }

    function remember(element: HTMLElement): void {
      if (!element.isConnected) return;
      let title = element.getAttribute("title");
      if (element.id === "__v_o__copy_error" && title === "Copy Error Info") {
        title = "Copy error info";
        element.setAttribute("aria-label", title);
      }
      if (title?.trim()) {
        const previous = titles.get(element);
        const saved: Title = { text: title, marker: previous ? previous.marker : element.getAttribute("data-dev-tooltip-title"),
          ...(previous?.addedLabel ? { addedLabel: previous.addedLabel } : {}) };
        if (element.matches("button, [role='button'], a[href]") && !element.textContent?.trim() &&
          !element.hasAttribute("aria-labelledby") && (!element.hasAttribute("aria-label") || element.getAttribute("aria-label") === previous?.addedLabel)) {
          element.setAttribute("aria-label", title);
          saved.addedLabel = title;
        }
        titles.set(element, saved);
        element.setAttribute("data-dev-tooltip-title", title);
        element.removeAttribute("title");
      }
    }

    function restore(element: HTMLElement, saved: Title): void {
      if (!element.hasAttribute("title")) element.setAttribute("title", saved.text);
      if (saved.marker === null) element.removeAttribute("data-dev-tooltip-title");
      else element.setAttribute("data-dev-tooltip-title", saved.marker);
      if (saved.addedLabel && element.getAttribute("aria-label") === saved.addedLabel) element.removeAttribute("aria-label");
    }

    function dismiss(): void {
      clearTimeout(timer);
      timer = undefined;
      open = false;
    }

    function candidate(event: Event): { element: HTMLElement; text: string } | undefined {
      for (const element of event.composedPath()) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.matches('#operations-error-context button[aria-current="true"]')) return;
        const host = owner(element);
        if (!host) continue;
        remember(element);
        const text = titles.get(element)?.text ?? (host === "vite-error-overlay" && element.matches("button")
          ? element.getAttribute("aria-label") : null);
        if (text?.trim()) return { element, text };
      }
    }

    function enter(event: Event): void {
      const hint = candidate(event);
      if (!hint || (event instanceof PointerEvent && event.pointerType === "touch")) return;
      const focused = event.type === "focusin";
      if (focused && !hint.element.matches(":focus-visible")) return;
      if (anchor === hint.element && (open || timer) && !focused) return;
      dismiss();
      anchor = hint.element;
      label = hint.text;
      side = hint.element.dataset.devTooltipSide === "right" ? "right" : "top";
      const reveal = () => {
        timer = undefined;
        if (hint.element.isConnected) open = true;
      };
      if (focused) reveal();
      else timer = setTimeout(reveal, 400);
    }

    function leave(event: Event): void {
      const related = (event as MouseEvent | FocusEvent).relatedTarget;
      if (related instanceof Node && anchor?.contains(related)) return;
      if (event.composedPath().includes(anchor as EventTarget)) dismiss();
    }

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") flushSync(dismiss);
    };
    const events = { pointerover: enter, pointerout: leave, focusin: enter, focusout: leave, pointerdown: dismiss };

    function detach(root: ShadowRoot, observer: MutationObserver): void {
      observer.disconnect();
      for (const [name, handler] of Object.entries(events)) root.removeEventListener(name, handler, true);
      root.removeEventListener("scroll", dismiss, true);
      roots.delete(root);
    }

    function inspect(node: Element): void {
      if (!node.isConnected) return;
      if (node instanceof HTMLElement && owner(node)) remember(node);
      if (node.shadowRoot && (owner(node) || ["dev-toolbar", "vite-error-overlay"].includes(node.localName))) attach(node.shadowRoot);
      for (const element of node.querySelectorAll("*")) {
        if (element instanceof HTMLElement && owner(element)) remember(element);
        if (element.shadowRoot && owner(element)) attach(element.shadowRoot);
      }
    }

    function changed(records: MutationRecord[]): void {
      if (anchor && !anchor.isConnected) { dismiss(); anchor = null; }
      if (anchor?.matches('#operations-error-context button[aria-current="true"]')) dismiss();
      for (const [root, observer] of roots) if (!root.host.isConnected) detach(root, observer);
      for (const [element, saved] of titles) if (!element.isConnected) {
        restore(element, saved);
        titles.delete(element);
      }
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) remember(record.target);
        for (const node of record.addedNodes) if (node instanceof Element) inspect(node);
      }
    }

    function attach(root: ShadowRoot): void {
      if (roots.has(root)) return;
      const observer = new MutationObserver(changed);
      roots.set(root, observer);
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["title", "aria-current"] });
      // Internal focus/hover transitions may be retargeted away at the host.
      for (const [name, handler] of Object.entries(events)) root.addEventListener(name, handler, true);
      root.addEventListener("scroll", dismiss, true);
      for (const node of root.children) inspect(node);
    }

    const observer = new MutationObserver(changed);
    observer.observe(document.body, { childList: true });
    for (const host of document.querySelectorAll("dev-toolbar, vite-error-overlay")) inspect(host);
    for (const [name, handler] of Object.entries(events)) document.addEventListener(name, handler, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", dismiss);

    return () => {
      dismiss();
      observer.disconnect();
      for (const [root, observer] of roots) detach(root, observer);
      for (const [name, handler] of Object.entries(events)) document.removeEventListener(name, handler, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", dismiss);
      for (const [element, saved] of titles) restore(element, saved);
    };
  });
</script>

<Tooltip.Provider delayDuration={400} ignoreNonKeyboardFocus disableHoverableContent>
  <Tooltip.Root bind:open>
    <Tooltip.Portal>
      <Tooltip.Content customAnchor={anchor} role="tooltip" aria-hidden={!open} class="app-tooltip"
        style="z-index: 2147483647" {side} sideOffset={8} collisionPadding={8}>
        {label}<Tooltip.Arrow class="tooltip-arrow" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
