<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Operation } from "$lib/catalog.ts";
  import { getOperationReport } from "$lib/operation-report.ts";
  import Disclosure from "$lib/components/Disclosure.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import JsonView from "$lib/components/JsonView.svelte";

  let { operation }: { operation: Operation } = $props();
  const inputLocations = [{ key: "path", label: "Path" }, { key: "query", label: "Query" }, { key: "header", label: "Headers" }, { key: "body", label: "Body" }] as const;
  let schemaOpen = $state(false);
  let schemaLoaded = $state(false);
  let schemaWrap = $state(true);
  let copying = $state(false);
  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const report = $derived.by(() => {
    try { return { data: getOperationReport(operation), error: "" }; }
    catch (failure) { return { data: null, error: `Could not prepare the operation report: ${failure instanceof Error ? failure.message : String(failure)}` }; }
  });

  onDestroy(() => { disposed = true; clearTimeout(copyStatusTimer); });

  function showCopyStatus(message: string) {
    if (disposed) return;
    copyStatus = message;
    copyStatusTimer = setTimeout(() => copyStatus = "", 5000);
  }

  async function copySchema(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const schema = report.data?.schema;
    if (!schema || copying) return;
    copying = true;
    clearTimeout(copyStatusTimer);
    copyStatus = "";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
      if (report.data?.schema === schema) showCopyStatus("JSON copied.");
    } catch {
      if (report.data?.schema === schema) showCopyStatus("Could not copy JSON. Check clipboard access and try again.");
    } finally { copying = false; }
  }
</script>

<section class="detail-report" aria-label="Operation report">
  {#if report.data}
    {@const data = report.data}
    <dl class="report-metrics">
      <div class="report-metric"><dd class="report-metric-value">{data.catalog.title}</dd><dt class="report-metric-label">Catalog</dt></div>
      <div class="report-metric"><dd class="report-metric-value">{operation.method}</dd><dt class="report-metric-label">Method</dt></div>
      <div class="report-metric"><dd class="report-metric-value">{#each operation.path.split("/") as segment, index}{#if index}/<wbr />{/if}{segment}{/each}</dd><dt class="report-metric-label">Path</dt></div>
    </dl>

    <section class="report-section" aria-label="Operation metadata">
      <h3>Metadata</h3>
      <dl class="report-facts report-inset report-record">
        <dt>Operation ID</dt><dd>{data.operationId}</dd>
        <dt>Catalog identifier</dt><dd>{operation.id}</dd>
        <dt>File</dt><dd>{data.catalog.file}</dd>
        <dt>Catalog version</dt><dd>{data.catalog.version}</dd>
        <dt>OpenAPI version</dt><dd>{data.catalog.openapi}</dd>
        <dt>Name</dt><dd>{data.summary || "—"}</dd>
        <dt>Description</dt><dd>{data.description || "—"}</dd>
      </dl>
      {#each inputLocations as location (location.key)}
        {@const fields = operation.fields.filter(field => field.location === location.key)}
        {#if fields.length}
        <table class="report-table">
          <caption>Input properties · <strong>{location.label}</strong></caption>
          <thead><tr><th scope="col">Property</th><th scope="col">Label</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Description</th></tr></thead>
          <tbody>{#each fields as field (field.key)}
            <tr>
              <th scope="row" data-label="Property"><code>{field.name}</code></th>
              <td data-label="Label">{field.label}</td>
              <td data-label="Type">{field.type}</td>
              <td data-label="Required">{field.required ? "Yes" : "No"}</td>
              <td data-label="Description">{field.description || "—"}</td>
            </tr>
          {/each}</tbody>
        </table>
        {/if}
      {/each}
    </section>

    {#if data.groups.length}
      <section class="report-section" aria-label="Operation grouping">
        <h3>Grouping</h3>
        <ol class="report-groups">{#each data.groups as group, index (group.id)}
          <li style:--group-depth={index}>
            <dl class="report-facts report-inset report-record"><dt>Name</dt><dd>{group.name}</dd><dt>Description</dt><dd>{group.description || "—"}</dd></dl>
          </li>
        {/each}</ol>
      </section>
    {/if}

    <section class="report-section" aria-label="Operational JSON schema">
      <h3>Operational JSON schema</h3>
      <p class="report-muted">OpenAPI schema for this operation, including its referenced definitions.</p>
      {#if data.warnings.length}<ul class="schema-warnings" role="status">{#each data.warnings as warning}<li>{warning}</li>{/each}</ul>{/if}
      <Disclosure class="schema-disclosure" label="OpenAPI schema" open={schemaOpen} onToggle={(next) => { schemaOpen = next; if (next) schemaLoaded = true; }}>
        {#snippet summary()}
          <HintButton class="schema-action" label="Copy JSON" aria-label="Copy JSON" aria-disabled={copying} aria-busy={copying} onclick={copySchema}><MaterialIcon name="file_copy" size={20} /></HintButton>
          <MaterialIcon name="chevron_forward" class="schema-chevron" size={20} />
          <span class="schema-title">OpenAPI schema<span class="schema-copy-status" role="status">{copyStatus}</span></span>
          {#if schemaOpen}<HintButton class="schema-action" label="Wrap lines" aria-label="Wrap lines" aria-pressed={schemaWrap}
            onclick={(event) => { event.preventDefault(); event.stopPropagation(); schemaWrap = !schemaWrap; }}><MaterialIcon name={schemaWrap ? "format_text_wrap" : "format_text_overflow"} size={20} /></HintButton>{/if}
        {/snippet}
        {#if schemaLoaded}<JsonView value={data.schema} label="Operation OpenAPI JSON" wrap={schemaWrap} />{/if}
      </Disclosure>
    </section>
  {:else}<p role="alert" class="error">{report.error}</p>{/if}
</section>

<style>
  .report-metric-value { font-size: clamp(16px, 1.7vw, 22px); font-weight: 700; }
  .report-groups { margin: 0; padding: 0; list-style: none; }
  .report-groups li { position: relative; margin-left: calc(var(--group-depth) * 24px); }
  .report-groups li + li { margin-top: 14px; }
  .report-groups li + li::before { position: absolute; content: ''; left: -12px; top: -14px; width: 12px; height: 38px; border-left: 2px solid var(--color-border); border-bottom: 2px solid var(--color-border); border-bottom-left-radius: 4px; }
  :global(.schema-disclosure) { margin-top: 16px; }
  :global(.schema-disclosure > summary) { position: sticky; top: calc(var(--app-header-height) + 8px); z-index: 2; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 14px; border-radius: 4px; list-style: none; background: var(--color-report-card); color: var(--color-foreground); font-size: 14px; font-weight: 650; transition: background-color 180ms ease-in, color 180ms ease-in, transform 180ms ease-in, outline-color 180ms ease-in; }
  :global(.schema-disclosure > summary:is(:hover,:focus-within,[aria-expanded="true"])) { background: var(--color-json-header-hover-background); color: var(--color-json-header-hover-foreground); }
  :global(.schema-chevron) { transition: transform 180ms ease-in; }
  :global(.schema-disclosure > summary[aria-expanded="true"] .schema-chevron) { transform: rotate(90deg); }
  .schema-title { flex: 1; min-width: 0; }
  .schema-copy-status { position: absolute; top: calc(100% + 8px); left: 0; max-width: 100%; padding: 6px 10px; border-radius: 4px; background: var(--color-badge-background); color: var(--color-muted-foreground); font-size: 11px; font-weight: 700; pointer-events: none; }
  .schema-copy-status:empty { padding: 0; }
  :global(.schema-action) { display: inline-grid; place-items: center; flex: 0 0 28px; width: 28px; height: 32px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; }
  :global(.schema-action:is(:hover,:focus-visible):enabled) { background: var(--color-json-header-hover-foreground); color: var(--color-json-header-hover-background); }
  :global(.schema-action:focus-visible) { outline-color: var(--color-json-header-hover-foreground); }
  :global(.schema-disclosure .json-view) { margin-top: 4px; }
  .schema-warnings { padding-left: 20px; color: var(--color-accent); font-size: 12px; overflow-wrap: anywhere; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    :global(.detail-report .schema-disclosure > summary:not([inert] *)) { will-change: transform; }
    :global(.detail-report .schema-disclosure > summary:hover) { transform: scale(min(1.06, var(--hover-scale, 1.06))); }
  }
  @media (max-width: 599px) { .report-groups li { margin-left: calc(var(--group-depth) * 16px); } }
</style>
