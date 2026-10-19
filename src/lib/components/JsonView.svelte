<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import Disclosure from "./Disclosure.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";

  type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
  type Reference = { path: string; ancestors: string[]; value: JsonValue };
  let { value, label = "JSON document", wrap = true, expandedPaths, resetKey = 0, pageSize, validated = false }: { value: unknown; label?: string; wrap?: boolean; expandedPaths?: string[] | undefined; resetKey?: number; pageSize?: number | undefined; validated?: boolean } = $props();
  let expanded = $state<Record<string, boolean>>({});
  let loaded = $state(1000);
  let referencePage = $state.raw<Reference>();
  const targets = new Map<string, HTMLElement>();
  let navigation = 0;
  const expandedDefaults = $derived(expandedPaths ? new Set(expandedPaths) : undefined);
  const childPath = (array: boolean, path: string, key: string) => array ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
  const page = $derived.by(() => {
    const paths = new Set<string>();
    let remaining = pageSize === undefined ? Infinity : loaded;
    const visit = (item: JsonValue, path: string, key: string | null): boolean => {
      const object = item !== null && typeof item === "object";
      const lines = object ? key === null ? 2 : 3 : 1;
      if (remaining < lines) return false;
      remaining -= lines; paths.add(path);
      if (object && (expanded[path] ?? (expandedDefaults?.has(path) ?? true))) {
        for (const [key, value] of Object.entries(item)) {
          if (!visit(value, childPath(Array.isArray(item), path, key), Array.isArray(item) ? null : key)) return false;
        }
      }
      return true;
    };
    let more = !visit(document.value, "$", null);
    if (pageSize !== undefined && referencePage) {
      // Reveal the route and one bounded page at the destination, rather than
      // rendering every preceding sibling in a large document.
      for (const path of referencePage.ancestors) paths.add(path);
      remaining = loaded;
      more = !visit(referencePage.value, referencePage.path, null) || more;
    }
    return { paths, more };
  });

  const document = $derived.by(() => {
    if (validated) return { value: value as JsonValue, error: "" };
    try {
      const text = JSON.stringify(value, null, 2);
      if (text === undefined) return { value: null, error: "This value cannot be represented as JSON." };
      const parsed: JsonValue = JSON.parse(text);
      return { value: parsed, error: "" };
    } catch {
      return { value: null, error: "This value cannot be represented as JSON." };
    }
  });

  $effect(() => {
    document.value;
    expandedPaths;
    resetKey;
    navigation++;
    referencePage = undefined;
    expanded = {};
    loaded = pageSize ?? 1000;
  });

  onDestroy(() => navigation++);

  function reference(value: string): Reference | undefined {
    if (!value.startsWith("#")) return;
    let pointer: string;
    try { pointer = decodeURIComponent(value.slice(1)); } catch { return; }
    if ((pointer !== "" && !pointer.startsWith("/")) || /~(?:[^01]|$)/.test(pointer)) return;
    let item = document.value;
    let path = "$";
    const ancestors = [path];
    for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
      const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!item || typeof item !== "object" || !Object.hasOwn(item, key)
        || Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(key)) return;
      path = childPath(Array.isArray(item), path, key);
      item = Array.isArray(item) ? item[Number(key)]! : item[key]!;
      ancestors.push(path);
    }
    return { path, ancestors, value: item };
  }

  function registerTarget(element: HTMLElement, path: string) {
    targets.set(path, element);
    return { destroy: () => { if (targets.get(path) === element) targets.delete(path); } };
  }

  async function followReference(destination: Reference) {
    const current = ++navigation;
    referencePage = destination;
    for (const path of destination.ancestors) expanded[path] = true;
    await tick();
    const element = targets.get(destination.path);
    const target = element?.closest<HTMLElement>("summary") ?? element;
    if (!target) return;
    // Nested disclosures and the containing schema can resize together. Scroll
    // to their settled geometry without guessing a delay or finishing animations.
    const panels = new Set<HTMLElement>();
    const ownPanel = target.closest("details")?.querySelector<HTMLElement>(":scope > .disclosure-panel");
    if (ownPanel) panels.add(ownPanel);
    for (let parent = target.parentElement; parent; parent = parent.parentElement)
      if (parent.classList.contains("disclosure-panel")) panels.add(parent);
    while (current === navigation && target.isConnected) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const animations = [...panels].flatMap(panel => panel.getAnimations()).filter(animation =>
        animation.playState !== "finished" && animation.effect instanceof KeyframeEffect
        && animation.effect.getKeyframes().some(frame => "height" in frame));
      if (!animations.length) break;
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    }
    if (current !== navigation || !target.isConnected) return;
    if (target.tagName !== "SUMMARY") target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center", inline: "nearest" });
  }
</script>

{#snippet property(key: string | null)}
  {#if key !== null}<span class="json-key">{JSON.stringify(key)}</span><span class="json-punctuation">{": "}</span>{/if}
{/snippet}

{#snippet entry(item: JsonValue, path: string, key: string | null, comma: boolean, depth: number)}
  {#if item !== null && typeof item === "object"}
    {@const array = Array.isArray(item)}
    {@const entries = Object.entries(item)}
    {#if key !== null}<div class="json-line json-container-key">{@render property(key)}</div>{/if}
    {#if entries.length}
      {@const open = expanded[path] ?? (expandedDefaults?.has(path) ?? true)}
      <Disclosure class="json-branch" {open} lazy={expandedPaths !== undefined || pageSize !== undefined} groupLabel={`${label}: ${path}`}
        label={`${path}: ${entries.length} ${array ? "items" : "properties"}`} tooltipEnabled={false}
        onToggle={(next) => { navigation++; expanded[path] = next; }}>
        {#snippet summary()}
          <span class="json-toggle" aria-hidden="true"><MaterialIcon name="chevron_forward" size={16} /></span><span class="json-bracket" use:registerTarget={path}>{array ? "[" : "{"}</span>{#if !open}<span class="json-folded">{" … "}</span><span class="json-bracket">{array ? "]" : "}"}</span><span class="json-punctuation">{comma ? "," : ""}</span>{/if}
        {/snippet}
          <div class="json-children" style:--json-depth-indent={`${(depth + 1) * 2}ch`}>
            {#each (pageSize === undefined ? entries : entries.filter(([childKey]) => page.paths.has(childPath(array, path, childKey)))) as [childKey, childValue], index (childKey)}
              {@render entry(childValue, childPath(array, path, childKey), array ? null : childKey, index < entries.length - 1, depth + 1)}
            {/each}
          </div><div class="json-line json-closing"><span class="json-bracket">{array ? "]" : "}"}</span><span class="json-punctuation">{comma ? "," : ""}</span></div>
      </Disclosure>
    {:else}
      <div class="json-line" use:registerTarget={path}><span class="json-bracket">{array ? "[" : "{"}</span></div>
      <div class="json-line json-closing"><span class="json-bracket">{array ? "]" : "}"}</span><span class="json-punctuation">{comma ? "," : ""}</span></div>
    {/if}
  {:else}
    {@const destination = key === "$ref" && typeof item === "string" ? reference(item) : undefined}
    <div class="json-line" class:json-string-line={typeof item === "string"} use:registerTarget={path}>{#if key !== null}<span class="json-property">{@render property(key)}</span>{/if}<span class="json-value">{#if destination}<button type="button" class="json-reference json-string" aria-label={`Go to ${item}`} onclick={() => followReference(destination)}>{JSON.stringify(item)}</button>{:else}<span class:json-string={typeof item === "string"} class:json-description={typeof item === "string" && key !== null && ["description", "title", "version", "openapi", "summary"].includes(key)} class:json-description-text={key === "description" && typeof item === "string"} class:json-number={typeof item === "number"} class:json-boolean={typeof item === "boolean"} class:json-null={item === null}>{JSON.stringify(item)}</span>{/if}<span class="json-punctuation">{comma ? "," : ""}</span></span></div>
  {/if}
{/snippet}

<section class="json-view" aria-label={label}>
  {#if document.error}
    <p class="json-error" role="alert">{document.error}</p>
  {:else}
    <div class="json-scroll" role="document" aria-label={`Read-only ${label}`}>
      <div class="json-tree" class:wrap>
        {@render entry(document.value, "$", null, false, 0)}
      </div>
    </div>
    {#if pageSize !== undefined && page.more}
      <button class="json-load-more" onclick={() => loaded += pageSize}>Load more</button>
    {/if}
  {/if}
</section>

<style>
  .json-load-more { display: block; margin: 6px auto 0; padding: 5px 10px; border: 0; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); font: inherit; font-size: 11px; cursor: pointer; }
  .json-view { min-width: 0; max-width: 100%; color: var(--color-foreground); }
  .json-error { color: var(--color-error-foreground); background: var(--color-error-background); }
  .json-error { padding: 12px; font-size: 12px; }
  .json-scroll { width: 100%; min-width: 0; max-width: 100%; overflow: auto; border: 1px solid transparent; border-radius: 4px; background: var(--color-report-card); outline: 2px solid transparent; outline-offset: 2px; transition: outline-color 180ms ease-in; }
  .json-scroll:focus-visible { outline-color: var(--color-foreground); }
  .json-tree { --json-white-space: pre-wrap; --json-indent: 0ch; min-width: 0; padding: 12px 0; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .json-tree.wrap { container-type: inline-size; }
  .json-tree:not(.wrap) { --json-white-space: pre; width: max-content; min-width: 100%; overflow-wrap: normal; }
  .json-view :global(.json-branch) { min-width: 0; white-space: normal; }
  .json-view :global(.json-branch > summary) { position: relative; white-space: var(--json-white-space); margin-left: 8px; padding: 0 12px 0 calc(4px + var(--json-indent) + 1.1rem); list-style: none; border-radius: 2px; outline: 2px solid transparent; outline-offset: -2px; transition: background-color 180ms ease-in, outline-color 180ms ease-in; }
  .json-toggle { position: absolute; left: 2px; top: 2px; display: grid; place-items: center; width: 16px; height: 16px; color: var(--color-surface); transition: transform 180ms ease-in, color 180ms ease-in; }
  .json-view :global(.json-branch > summary[aria-expanded="true"] > .json-toggle) { transform: rotate(90deg); }
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible)) { background: var(--color-surface); }
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible) > :is(.json-toggle, .json-bracket)),
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible) + .disclosure-panel > .json-closing > .json-bracket) { color: var(--color-foreground); }
  .json-view :global(.json-branch > summary:focus-visible) { outline-color: var(--color-foreground); }
  .json-line { white-space: var(--json-white-space); padding: 0 12px 0 calc(12px + var(--json-indent) + 1.1rem); }
  .json-tree.wrap .json-string-line { display: flex; flex-wrap: wrap; }
  .json-tree.wrap .json-string-line > .json-property { flex: 0 0 auto; max-width: 100%; }
  .json-tree.wrap .json-string-line > .json-value { flex: 1; min-width: min(100%, 4ch); padding-left: 1ch; text-indent: -1ch; }
  .json-children { position: relative; --json-indent: var(--json-depth-indent); }
  .json-tree.wrap .json-children { --json-indent: min(var(--json-depth-indent), max(0px, calc(100cqi - 24px - 1.1rem - 4ch))); }
  .json-children::before { content: ''; position: absolute; top: 4px; bottom: 4px; left: calc(12px + 1.1rem + var(--json-indent) - 1.5ch); width: 1px; color: var(--color-surface); background: radial-gradient(circle at 0.5px 0.5px, currentColor 0.5px, transparent 0.5px) 0 0 / 1px 3px repeat-y; opacity: 0.5; pointer-events: none; transition: color 180ms ease-in; }
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible) + .disclosure-panel > .json-children)::before { color: var(--color-foreground); }
  .json-punctuation { color: var(--color-muted-foreground); }
  .json-bracket { color: var(--color-surface); }
  .json-folded { color: var(--color-accent); }
  .json-key { color: var(--color-json-key); font-weight: 600; }
  .json-key, .json-bracket { transition: color 180ms ease-in; }
  .json-string { color: var(--color-json-string); }
  .json-reference { padding: 0; border: 0; border-radius: 2px; background: transparent; font: inherit; text-align: inherit; white-space: inherit; overflow-wrap: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .json-reference:is(:hover, :focus-visible) { color: var(--color-foreground); }
  .json-reference:focus-visible, .json-line:focus-visible { outline: 2px solid var(--color-foreground); outline-offset: 2px; }
  .json-line, .json-view :global(.json-branch > summary) { scroll-margin-block: calc(var(--app-header-height, 0px) + var(--settings-header-height, 0px) + 64px) 32px; }
  .json-description { color: var(--color-json-description); }
  .json-description-text { font-style: italic; }
  .json-number { color: var(--color-json-value); font-weight: 700; }
  .json-boolean { color: var(--color-json-value); font-weight: 700; }
  .json-null { color: var(--color-muted-foreground); font-style: italic; }
  @media (prefers-reduced-motion: reduce) { .json-scroll, .json-toggle, .json-key, .json-bracket, .json-children::before, .json-view :global(.json-branch > summary) { transition: none; } }
  @media (forced-colors: active) { .json-scroll:not(:focus-visible), .json-view :global(.json-branch > summary:not(:focus-visible)) { outline-style: none; } }
</style>
