// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import toolbarTheme from "./toolbar-theme.css?inline";

/** Keep the dev toolbar's open shadow roots on the application's active palette. */
export function initToolbarTheme(): () => void {
  const roots = new Map<ShadowRoot, { observer: MutationObserver; style: HTMLStyleElement }>();
  // The toolbar writes body.style.cursor while dragging outside its shadow root.
  // Observe the existing inline state in CSS without taking over its cleanup.
  const dragStyle = document.createElement("style");
  dragStyle.dataset.operationsToolbarCursor = "";
  dragStyle.textContent = `body:has(> dev-toolbar):is([style*="cursor: grabbing"], [style*="cursor:grabbing"]) {
    cursor: var(--cursor-grabbing, grabbing) !important;
  }`;
  document.head.append(dragStyle);

  function prune(): void {
    for (const [root, entry] of roots) {
      if (!root.host.isConnected) {
        entry.observer.disconnect();
        roots.delete(root);
      }
    }
  }

  function inspect(root: ParentNode): void {
    if (root instanceof Element && root.shadowRoot) attach(root.shadowRoot);
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) attach(element.shadowRoot);
    }
  }

  function attach(root: ShadowRoot): void {
    if (roots.has(root)) return;
    const style = document.createElement("style");
    style.dataset.operationsToolbarTheme = "";
    style.textContent = toolbarTheme;

    function apply(): void {
      // The toolbar manages its first style element and replaces adoptedStyleSheets
      // on each render. Add our own style only after its initial render has begun.
      if (!style.isConnected && (root.host.localName !== "dev-toolbar" || root.querySelector("style"))) {
        root.append(style);
      }
    }

    const observer = new MutationObserver(records => {
      prune();
      apply();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) inspect(node);
        }
      }
    });
    roots.set(root, { observer, style });
    observer.observe(root, { childList: true, subtree: true });
    apply();
    inspect(root);
  }

  function findToolbars(root: ParentNode): void {
    function inspectToolbar(toolbar: HTMLElement): void {
      toolbar.inert = document.documentElement.dataset.developerToolbar !== "true";
      inspect(toolbar);
    }
    if (root instanceof HTMLElement && root.localName === "dev-toolbar") inspectToolbar(root);
    for (const toolbar of root.querySelectorAll<HTMLElement>("dev-toolbar")) inspectToolbar(toolbar);
  }

  const observer = new MutationObserver(records => {
    prune();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) findToolbars(node);
      }
    }
  });
  // The Vite plugin appends each toolbar instance directly to body.
  observer.observe(document.body, { childList: true });
  findToolbars(document);

  const dispose = () => {
    observer.disconnect();
    dragStyle.remove();
    for (const [root, { observer: rootObserver, style }] of roots) {
      rootObserver.disconnect();
      style.remove();
    }
    roots.clear();
  };
  import.meta.hot?.dispose(dispose);
  return dispose;
}
