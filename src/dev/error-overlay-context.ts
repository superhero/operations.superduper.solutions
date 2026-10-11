// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { getErrorChain } from "./error-chain.ts";

let activeDispose: (() => void) | undefined;

/** Visulima flattens the original error and its causes in this display order. */
function currentErrors(overlay: Element): readonly unknown[] | undefined {
  try {
    const payload: unknown = Reflect.get(overlay, "__v_oPayload");
    if (!payload || typeof payload !== "object") return;
    const errors: unknown = Reflect.get(payload, "errors");
    return Array.isArray(errors) ? errors : undefined;
  } catch { return; }
}

/** Navigate the cause chain through Visulima's existing pagination controls. */
export function initErrorOverlayContext(): () => void {
  activeDispose?.();
  const overlays = new Map<ShadowRoot, () => void>();
  const pagination = "#__v_o__pagination_current, #__v_o__pagination_total";
  const stacktrace = "#__v_o__stacktrace";
  const codeframe = ".shiki";
  const relevant = `${pagination}, ${stacktrace}, ${codeframe}, #__v_o__notch, #__v_o__message, #__v_o__error-overlay-pagination-previous, #__v_o__error-overlay-pagination-next`;

  function syncPageScroll(): void {
    const open = [...overlays.keys()].some(root => root.host.isConnected
      && root.querySelector("#__v_o__root:not(.hidden)"));
    const page = document.documentElement;
    if (open === page.hasAttribute("data-error-overlay-open")) return;
    if (open) {
      if (document.getElementById("startup-status") && !page.style.getPropertyValue("--startup-gutter")) {
        page.setAttribute("data-startup-measuring", "");
        const gutter = Math.max(0, innerWidth - page.getBoundingClientRect().width);
        page.removeAttribute("data-startup-measuring");
        page.style.setProperty("--startup-gutter", `${gutter}px`);
      }
      // Replace the removed native gutter with padding, keeping the backdrop
      // full-width and preserving any space already reserved by the loader.
      const gutter = Math.max(0, innerWidth - page.getBoundingClientRect().width)
        + (parseFloat(getComputedStyle(page).paddingInlineEnd) || 0);
      page.style.setProperty("--error-scrollbar-gutter", `${gutter}px`);
    }
    page.toggleAttribute("data-error-overlay-open", open);
    if (!open) page.style.removeProperty("--error-scrollbar-gutter");
  }

  function attach(overlay: Element): void {
    const root = overlay.shadowRoot;
    if (!root || overlays.has(root)) return;
    const caption = document.createElement("nav");
    caption.id = "operations-error-context";
    caption.setAttribute("aria-label", "Error cause chain");
    const emptyStack = document.createElement("span");
    emptyStack.textContent = "Stack trace is empty.";
    const issueLink = document.createElement("a");
    issueLink.id = "operations-error-issue";
    issueLink.href = "https://github.com/superhero/operations.superduper.solutions/issues/new";
    issueLink.target = "_blank";
    issueLink.rel = "noopener noreferrer";
    issueLink.title = "Report error";
    issueLink.setAttribute("aria-label", "Report error");
    const githubIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    githubIcon.setAttribute("viewBox", "0 0 24 24");
    githubIcon.setAttribute("fill", "currentColor");
    githubIcon.setAttribute("aria-hidden", "true");
    const githubPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    githubPath.setAttribute("d", "M12 .297C5.37 .297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.469-2.38 1.236-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.647 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12");
    githubIcon.append(githubPath);
    issueLink.append(githubIcon);
    let displayedErrors: readonly unknown[] | undefined;
    let chainKey = "";
    let rows: HTMLButtonElement[] = [];
    const labels = new Map<Element, { title: string | null; label: string | null }>();

    function select(index: number): void {
      const errors = currentErrors(overlay);
      if (!errors || index >= errors.length) return;
      // Re-read the live page after every native click; history can replace payloads.
      for (let remaining = errors.length; remaining > 0; remaining--) {
        const current = Number(root!.querySelector("#__v_o__pagination_current")?.textContent);
        if (!Number.isInteger(current) || current < 1 || current === index + 1) break;
        const direction = current > index + 1 ? "previous" : "next";
        const button = root!.querySelector<HTMLButtonElement>(`#__v_o__error-overlay-pagination-${direction}`);
        if (!button || button.disabled || currentErrors(overlay) !== errors) break;
        button.click();
        if (Number(root!.querySelector("#__v_o__pagination_current")?.textContent) === current) break;
      }
    }

    function update(): void {
      const copy = root!.querySelector("#__v_o__copy_error");
      const toolbar = root!.querySelector("#__v_o__notch");
      if (copy) {
        if (copy.previousElementSibling !== issueLink) copy.before(issueLink);
      } else if (toolbar && issueLink.parentElement !== toolbar) toolbar.append(issueLink);
      const original = root!.querySelector<HTMLButtonElement>('[data-flame-mode="original"]');
      if (original && !original.classList.contains("active")) original.click();

      const stackContent = root!.querySelector(`${stacktrace} > div`);
      if (stackContent && ![...stackContent.childNodes].some(node => node !== emptyStack && node.textContent?.trim())) {
        if (emptyStack.parentElement !== stackContent) stackContent.append(emptyStack);
      } else {
        emptyStack.remove();
      }

      for (const frame of root!.querySelectorAll<HTMLElement>(codeframe)) {
        const prefix = frame.querySelector(".line")?.textContent?.match(/^[ ❯>] ([ ]*\d+)(?: |$)/);
        if (prefix?.[1]) frame.style.setProperty("--codeframe-gutter-width", `${prefix[1].length + 3}ch`);
      }

      for (const line of root!.querySelectorAll(`${codeframe} .line`)) {
        if (!/^\s*[❯>] +\d+(?: |$)/.test(line.textContent ?? "")) continue;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          if (!text.trim()) continue;
          // Keep the gutter's spaces, without a fallback glyph shifting its numbers.
          // Shiki may put the caret in its own token or alongside the line number.
          if (/^\s*[❯>]/.test(text)) node.textContent = text.replace(/[❯>]/, " ");
          break;
        }
      }

      const payload = Reflect.get(overlay, "__v_oPayload") as { rootPath?: unknown } | undefined;
      if (typeof payload?.rootPath === "string" && payload.rootPath) {
        const prefix = `${payload.rootPath.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
        for (const button of root!.querySelectorAll<HTMLButtonElement>(`${stacktrace} .stack-link[data-file]`)) {
          const { file, line, column } = button.dataset;
          const asyncPrefix = file?.startsWith("async ") ? "async " : "";
          const path = file?.slice(asyncPrefix.length).replace(/\\/g, "/");
          if (!path?.startsWith(prefix) || !line || !column) continue;
          // Keep full paths in the payload and datasets for copying and editor links.
          const text = `${asyncPrefix}./${path.slice(prefix.length)}:${line}:${column}`;
          if (button.textContent !== text) button.textContent = text;
        }
      }

      for (const [direction, label] of [["previous", "Previous related detail"], ["next", "Next related detail"]]) {
        const button = root!.querySelector(`#__v_o__error-overlay-pagination-${direction}`);
        if (!button || !label) continue;
        if (!labels.has(button)) labels.set(button, { title: button.getAttribute("title"), label: button.getAttribute("aria-label") });
        button.setAttribute("title", label);
        button.setAttribute("aria-label", label);
      }

      const current = Number(root!.querySelector("#__v_o__pagination_current")?.textContent);
      const total = Number(root!.querySelector("#__v_o__pagination_total")?.textContent);
      const message = root!.querySelector("#__v_o__message");
      const errors = currentErrors(overlay);
      const chain = errors ? getErrorChain(errors) : [];
      if (!message || !Number.isInteger(current) || total <= 1 || chain.length !== total || current < 1 || current > total) {
        caption.remove();
        return;
      }
      const nextKey = JSON.stringify(chain);
      if (displayedErrors !== errors || chainKey !== nextKey) {
        displayedErrors = errors;
        chainKey = nextKey;
        caption.replaceChildren();
        rows = [];
        let parent: HTMLElement = caption;
        chain.forEach((error, index) => {
          const list = document.createElement("ol");
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = error.code === undefined ? error.name : `${error.name} · ${error.code}`;
          if (index > 0) {
            button.title = "Caused by";
            button.dataset.devTooltipSide = "right";
          }
          button.addEventListener("click", () => select(index));
          item.append(button);
          list.append(item);
          parent.append(list);
          parent = item;
          rows.push(button);
        });
      }
      rows.forEach((button, index) => {
        if (index === current - 1) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
      if (message.previousElementSibling !== caption) message.before(caption);
    }

    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === "attributes" && record.target instanceof Element
        && record.target.id === "__v_o__root")) syncPageScroll();
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.matches(pagination)) return true;
        if (target?.closest(`${stacktrace}, ${codeframe}`)) return true;
        // History changes may replace the header or message, including counters.
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches(relevant) || node.querySelector(relevant)));
      })) update();
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    overlays.set(root, () => {
      observer.disconnect();
      caption.remove();
      emptyStack.remove();
      issueLink.remove();
      for (const [button, original] of labels) {
        for (const [attribute, value] of [["title", original.title], ["aria-label", original.label]] as const) {
          if (value === null) button.removeAttribute(attribute);
          else button.setAttribute(attribute, value);
        }
      }
    });
    syncPageScroll();
    update();
  }

  function inspect(node: ParentNode): void {
    if (node instanceof Element && node.localName === "vite-error-overlay") attach(node);
    for (const overlay of node.querySelectorAll("vite-error-overlay")) attach(overlay);
  }

  const observer = new MutationObserver(records => {
    for (const [root, dispose] of overlays) {
      if (!root.host.isConnected) { dispose(); overlays.delete(root); }
    }
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) inspect(node);
    }
    syncPageScroll();
  });
  // Vite appends its overlay directly to body; keep application DOM unobserved.
  observer.observe(document.body, { childList: true });
  inspect(document);

  const dispose = () => {
    observer.disconnect();
    for (const cleanup of overlays.values()) cleanup();
    overlays.clear();
    syncPageScroll();
    if (activeDispose === dispose) activeDispose = undefined;
  };
  activeDispose = dispose;
  return dispose;
}

import.meta.hot?.dispose(() => activeDispose?.());
