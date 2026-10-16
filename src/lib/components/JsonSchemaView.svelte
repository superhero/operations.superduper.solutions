<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import Disclosure from "./Disclosure.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  import HintButton from "./HintButton.svelte";
  import JsonView from "./JsonView.svelte";

  let { value, label = "OpenAPI JSON", operationsOnly = false }: { value: unknown; label?: string; operationsOnly?: boolean } = $props();
  let schemaOpen = $state(false);
  let schemaLoaded = $state(false);
  let schemaWrap = $state(true);
  let resetKey = $state(0);
  const expandedPaths = $derived.by(() => {
    if (!operationsOnly) return undefined;
    const paths = value && typeof value === "object" && "paths" in value ? value.paths : undefined;
    return ["$", '$["paths"]', ...Object.keys(paths && typeof paths === "object" ? paths : {})
      .map(path => `$["paths"][${JSON.stringify(path)}]`)];
  });
  let copying = $state(false);
  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  onDestroy(() => { disposed = true; clearTimeout(copyStatusTimer); });

  function showCopyStatus(message: string) {
    if (disposed) return;
    copyStatus = message;
    copyStatusTimer = setTimeout(() => copyStatus = "", 5000);
  }

  async function copySchema(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const schema = value;
    if (copying) return;
    copying = true;
    clearTimeout(copyStatusTimer);
    copyStatus = "";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
      if (value === schema) showCopyStatus("JSON copied.");
    } catch {
      if (value === schema) showCopyStatus("Could not copy JSON. Check clipboard access and try again.");
    } finally { copying = false; }
  }
</script>

<Disclosure class="schema-disclosure" label="OpenAPI schema" open={schemaOpen} onToggle={(next) => {
  schemaOpen = next;
  if (next) { schemaLoaded = true; if (operationsOnly) resetKey += 1; }
}}>
  {#snippet summary()}
    <MaterialIcon name="keyboard_arrow_right" class="schema-chevron" size={18} />
    <HintButton class="schema-action" label="Copy JSON" aria-label="Copy JSON" aria-disabled={copying} aria-busy={copying} onclick={copySchema}><MaterialIcon name="file_copy" size={18} /></HintButton>
    <span class="schema-title">OpenAPI schema<span class="schema-copy-status" role="status">{copyStatus}</span></span>
    <span class="schema-wrap-control" class:visible={schemaOpen} inert={!schemaOpen} aria-hidden={!schemaOpen}>
      <HintButton class="schema-action" label="Wrap lines" aria-label="Wrap lines" aria-pressed={schemaWrap} tooltipEnabled={schemaOpen}
        onclick={(event) => { event.preventDefault(); event.stopPropagation(); schemaWrap = !schemaWrap; }}><MaterialIcon name={schemaWrap ? "format_text_wrap" : "format_text_overflow"} size={20} /></HintButton>
    </span>
  {/snippet}
  {#if schemaLoaded}<JsonView {value} {label} wrap={schemaWrap} {expandedPaths} {resetKey} />{/if}
</Disclosure>

<style>
  :global(.schema-disclosure) { margin-top: 16px; }
  :global(.schema-disclosure > summary) { position: sticky; top: calc(var(--app-header-height) + 8px); z-index: 2; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 14px; border-radius: 4px; list-style: none; background: var(--color-report-card); color: var(--color-foreground); font-size: 14px; font-weight: 650; transition: background-color 180ms ease-in, color 180ms ease-in, transform 180ms ease-in, outline-color 180ms ease-in; }
  :global(.schema-disclosure > summary[aria-expanded="true"]) { background: var(--color-json-header-hover-background); color: var(--color-json-header-hover-foreground); }
  :global(.schema-disclosure > summary:focus-visible) { outline-color: var(--color-foreground); }
  :global(.schema-disclosure .schema-chevron) { transition: transform 180ms ease-in; }
  :global(.schema-disclosure > summary[aria-expanded="true"] .schema-chevron) { transform: rotate(90deg); }
  .schema-title { flex: 1; min-width: 0; }
  .schema-wrap-control { display: inline-flex; flex: 0 0 28px; color: var(--color-json-header-hover-foreground); opacity: 0; visibility: hidden; transition: opacity 180ms ease, visibility 0s linear 180ms; }
  .schema-wrap-control.visible { opacity: 1; visibility: visible; transition-delay: 0s; }
  .schema-copy-status { position: absolute; top: calc(100% + 8px); left: 0; max-width: 100%; padding: 6px 10px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-muted-foreground); font-size: 11px; font-weight: 700; pointer-events: none; }
  .schema-copy-status:empty { padding: 0; }
  :global(.schema-disclosure .schema-action) { display: inline-grid; place-items: center; flex: 0 0 28px; width: 28px; height: 32px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; }
  :global(.schema-disclosure .schema-action:is(:hover,:focus-visible):enabled) { background: var(--color-json-header-hover-foreground); color: var(--color-json-header-hover-background); }
  :global(.schema-disclosure .schema-action:focus-visible) { outline-color: var(--color-json-header-hover-foreground); }
  :global(.schema-disclosure .json-view) { margin-top: 4px; }
  @media (prefers-reduced-motion: reduce) { .schema-wrap-control { transition: none; } }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    :global(.detail-report .schema-disclosure > summary:not([inert] *)) { will-change: transform; }
    :global(.detail-report .schema-disclosure > summary:hover) { transform: scale(min(1.06, var(--hover-scale, 1.06))); }
  }
</style>
