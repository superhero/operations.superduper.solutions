<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onDestroy, untrack, type Snippet } from "svelte";
  import Disclosure from "./Disclosure.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  import HintButton from "./HintButton.svelte";
  import JsonView from "./JsonView.svelte";

  let { value, load, onRelease, sourceKey = "", validated = false, label = "OpenAPI JSON", title = "OpenAPI schema", copyable = true, pageSize, operationsOnly = false, actions }:
    { value?: unknown; load?: () => Promise<unknown>; onRelease?: () => void; sourceKey?: string; validated?: boolean;
      label?: string; title?: string; copyable?: boolean; pageSize?: number; operationsOnly?: boolean; actions?: Snippet } = $props();
  let schemaOpen = $state(false);
  let schemaLoaded = $state(false);
  let schemaWrap = $state(true);
  let resetKey = $state(0);
  let loadedValue = $state.raw<unknown>();
  let loading = $state(false);
  let loadError = $state("");
  let pendingLoad: Promise<unknown> | undefined;
  let held = false;
  let generation = 0;
  let previousKey = untrack(() => sourceKey);
  const displayedValue = $derived(load ? loadedValue : value);
  const expandedPaths = $derived.by(() => {
    if (!operationsOnly) return undefined;
    const paths = displayedValue && typeof displayedValue === "object" && "paths" in displayedValue ? displayedValue.paths : undefined;
    const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
    return ["$", '$["info"]', '$["paths"]', ...Object.entries(paths && typeof paths === "object" ? paths : {})
      .flatMap(([path, item]) => {
        const branch = `$["paths"][${JSON.stringify(path)}]`;
        return [branch, ...Object.keys(item && typeof item === "object" ? item : {})
          .filter(key => methods.includes(key)).map(method => `${branch}[${JSON.stringify(method)}]`)];
      })];
  });
  let copying = $state(false);
  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  onDestroy(() => { disposed = true; release(); clearTimeout(copyStatusTimer); });

  function release() {
    generation++;
    pendingLoad = undefined;
    loadedValue = undefined;
    schemaLoaded = false;
    loading = false;
    loadError = "";
    if (held) { held = false; onRelease?.(); }
  }

  function obtain(): Promise<unknown> {
    if (!load) return Promise.resolve(value);
    if (!pendingLoad) { held = true; pendingLoad = load(); }
    return pendingLoad;
  }

  async function openSource() {
    const current = ++generation;
    loading = !!load;
    loadError = "";
    try {
      const document = await obtain();
      if (disposed || !schemaOpen || current !== generation) { onRelease?.(); return; }
      loadedValue = document;
      schemaLoaded = true;
      if (operationsOnly) resetKey++;
    } catch (error) {
      if (!disposed && schemaOpen && current === generation) {
        loadError = error instanceof Error ? error.message : "Could not load this schema.";
        pendingLoad = undefined;
      }
    } finally { if (current === generation) loading = false; }
  }

  $effect(() => {
    if (sourceKey === previousKey) return;
    previousKey = sourceKey;
    release();
    if (schemaOpen) void openSource();
  });

  function showCopyStatus(message: string) {
    if (disposed) return;
    copyStatus = message;
    copyStatusTimer = setTimeout(() => copyStatus = "", 5000);
  }

  async function copySchema(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const key = sourceKey;
    if (copying) return;
    copying = true;
    clearTimeout(copyStatusTimer);
    copyStatus = "";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      const schema = await obtain();
      await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
      if (sourceKey === key) showCopyStatus("JSON copied.");
    } catch {
      if (sourceKey === key) showCopyStatus("Could not copy JSON. Check clipboard access and try again.");
    } finally { copying = false; if (!schemaOpen) release(); }
  }
</script>

<Disclosure class="schema-disclosure" label={title} open={schemaOpen} lazy animateSize onClosed={release} onToggle={(next) => {
  schemaOpen = next;
  if (next) void openSource();
}}>
  {#snippet summary()}
    <MaterialIcon name="keyboard_arrow_right" class="schema-chevron" size={18} />
    <span class="schema-title">{title}<span class="schema-copy-status" role="status">{copyStatus}</span></span>
    <span class="schema-header-actions">
      <span class="schema-wrap-control" class:visible={schemaOpen} inert={!schemaOpen} aria-hidden={!schemaOpen}>
        <HintButton class="schema-action" label="Wrap lines" aria-label="Wrap lines" aria-pressed={schemaWrap} tooltipEnabled={schemaOpen}
          onclick={(event) => { event.preventDefault(); event.stopPropagation(); schemaWrap = !schemaWrap; }}><MaterialIcon name={schemaWrap ? "format_text_wrap" : "format_text_overflow"} size={20} /></HintButton>
      </span>
      {#if copyable}
        <HintButton class="schema-action" label="Copy JSON" aria-label="Copy JSON" aria-disabled={copying} aria-busy={copying} onclick={copySchema}><MaterialIcon name="file_copy" size={18} /></HintButton>
      {/if}
      {@render actions?.()}
    </span>
  {/snippet}
  {#if loading}<p class="schema-loading" role="status" aria-label="Loading schema">···</p>{/if}
  {#if loadError}<div class="schema-load-error"><p role="alert">{loadError}</p><button type="button" onclick={openSource}>Retry</button></div>{/if}
  {#if schemaLoaded}<JsonView value={displayedValue} {validated} {label} {pageSize} wrap={schemaWrap} {expandedPaths} {resetKey} />{/if}
</Disclosure>

<style>
  .schema-loading { margin: 8px 0; text-align: center; font-size: 20px; }
  .schema-load-error { padding: 10px; font-size: 12px; }
  :global(.schema-disclosure) { margin-top: 16px; }
  /* Swap contrasting colors together; inherited button colors must not lag behind. */
  :global(.schema-disclosure > summary) { position: sticky; top: calc(var(--app-header-height) + var(--settings-header-height, 0px) + 8px); z-index: 2; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 14px; border-radius: 4px; list-style: none; background: var(--color-report-card); color: var(--color-foreground); font-size: 14px; font-weight: 650; transition: transform 180ms ease-in, outline-color 180ms ease-in; }
  :global(.schema-disclosure > summary[aria-expanded="true"]) { background: var(--color-json-header-hover-background); color: var(--color-json-header-hover-foreground); }
  :global(.schema-disclosure > summary:focus-visible) { outline-color: var(--color-foreground); }
  :global(.schema-disclosure .schema-chevron) { transition: transform 180ms ease-in; }
  :global(.schema-disclosure > summary[aria-expanded="true"] .schema-chevron) { transform: rotate(90deg); }
  .schema-title { flex: 1; min-width: 0; }
  .schema-header-actions { display: inline-flex; align-items: center; flex: 0 0 auto; gap: inherit; margin-left: auto; }
  .schema-wrap-control { display: inline-flex; flex: 0 0 28px; color: var(--color-json-header-hover-foreground); opacity: 0; visibility: hidden; transition: opacity 180ms ease, visibility 0s linear 180ms; }
  .schema-wrap-control.visible { opacity: 1; visibility: visible; transition-delay: 0s; }
  .schema-copy-status { position: absolute; top: calc(100% + 8px); left: 0; max-width: 100%; padding: 6px 10px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-muted-foreground); font-size: 11px; font-weight: 700; pointer-events: none; }
  .schema-copy-status:empty { padding: 0; }
  :global(.schema-disclosure .schema-action) { display: inline-grid; place-items: center; flex: 0 0 28px; width: 28px; height: 32px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; transition: transform 180ms ease-in, outline-color 180ms ease-in; }
  :global(.schema-disclosure .schema-action:is(:hover,:focus-visible):enabled) { background: var(--color-json-header-hover-foreground); color: var(--color-json-header-hover-background); }
  :global(.schema-disclosure .schema-action:focus-visible) { outline-color: var(--color-json-header-hover-foreground); }
  :global(.schema-disclosure .json-view) { margin-top: 4px; }
  @media (prefers-reduced-motion: reduce) { .schema-wrap-control { transition: none; } }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    :global(.detail-report .schema-disclosure > summary:not([inert] *)) { will-change: transform; }
    :global(.detail-report .schema-disclosure > summary:hover) { transform: scale(min(1.06, var(--hover-scale, 1.06))); }
  }
</style>
