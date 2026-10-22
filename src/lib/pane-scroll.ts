// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { tick } from "svelte";

type Options = { active: boolean; ready?: boolean; position: number; onposition: (position: number) => void };
const readers = new Set<() => void>();
export function flushPaneScroll(): void { for (const read of readers) read(); }

/** Restore after autofocus/layout, including lazy content, without competing with user input. */
export function rememberPaneScroll(node: HTMLElement, initial: Options) {
  let options = initial, restoring = initial.active, revision = 0;
  let frame = 0, deadline: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined;
  function stop() {
    revision += 1; restoring = false;
    cancelAnimationFrame(frame); clearTimeout(deadline); observer?.disconnect();
    node.style.removeProperty("overflow-anchor");
  }
  function remember() { if (options.active && !restoring) options.onposition(node.scrollTop); }
  function interrupt(event: Event) {
    // Browser shortcuts such as refresh must not discard a pending restoration.
    if (event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey || event.altKey)) return;
    stop();
  }
  async function restore() {
    const request = ++revision, position = options.position;
    restoring = true;
    if (options.ready === false) return;
    node.style.overflowAnchor = "none";
    await tick();
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await Promise.allSettled(node.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    if (request !== revision || !options.active) return;
    const finish = () => { if (request !== revision) return; stop(); remember(); };
    const apply = () => {
      if (request !== revision) return;
      node.scrollTop = position;
      if (Math.abs(node.scrollTop - position) < 1) finish();
    };
    // Content such as the Browser dashboard may still grow after its disclosure opens.
    observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply); });
    const watch = (content: Element) => {
      if (getComputedStyle(content).display === "contents") for (const child of content.children) watch(child);
      else observer!.observe(content);
    };
    for (const content of node.children) watch(content);
    deadline = setTimeout(finish, 1500);
    frame = requestAnimationFrame(apply);
  }
  node.addEventListener("scroll", remember);
  readers.add(remember);
  node.addEventListener("pointerdown", interrupt, true);
  node.addEventListener("wheel", interrupt, { capture: true, passive: true });
  node.addEventListener("keydown", interrupt, true);
  if (initial.active) void restore();
  return {
    update(next: Options) {
      const reopening = !options.active && next.active;
      const ready = options.ready === false && next.ready !== false;
      options = next;
      if (!next.active) stop();
      else if (reopening || restoring && ready) void restore();
    },
    destroy() {
      stop();
      readers.delete(remember);
      node.removeEventListener("scroll", remember);
      node.removeEventListener("pointerdown", interrupt, true);
      node.removeEventListener("wheel", interrupt, true);
      node.removeEventListener("keydown", interrupt, true);
    },
  };
}
