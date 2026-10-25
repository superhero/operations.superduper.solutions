<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import type { Operation } from "$lib/catalog.ts";
  import { getOperationReport } from "$lib/operation-report.ts";
  import { categoryLabel } from "$lib/category-label.ts";
  import JsonSchemaView from "$lib/components/JsonSchemaView.svelte";
  import OperationCapabilities from "$lib/components/OperationCapabilities.svelte";

  let { operation }: { operation: Operation } = $props();
  const inputLocations = [{ key: "path", label: "Path" }, { key: "query", label: "Query" }, { key: "header", label: "Headers" }, { key: "body", label: "Body" }] as const;
  const report = $derived.by(() => {
    try { return { data: getOperationReport(operation), error: "" }; }
    catch (failure) { return { data: null, error: `Could not prepare the operation report: ${failure instanceof Error ? failure.message : String(failure)}` }; }
  });
  const serverUrls = $derived.by(() => {
    const servers = report.data?.schema.servers;
    return Array.isArray(servers) ? servers.flatMap(server =>
      server && typeof server.url === "string" ? [server.url] : []) : [];
  });
</script>

<section class="detail-report" aria-label="Operation report">
  <OperationCapabilities {operation} />
  {#if report.data}
    {@const data = report.data}
    <dl class="report-metrics">
      <div class="report-metric"><dd class="report-metric-value">{data.catalog.title}</dd><dt class="report-metric-label">Catalog</dt></div>
      <div class="report-metric"><dd class="report-metric-value">{data.catalog.protocol ? "JSON-RPC" : operation.method}</dd><dt class="report-metric-label">{data.catalog.protocol ? "Protocol" : "Method"}</dt></div>
      <div class="report-metric"><dd class="report-metric-value">{#each operation.path.split("/") as segment, index}{#if index}/<wbr />{/if}{segment}{/each}</dd><dt class="report-metric-label">{data.catalog.protocol ? "Method" : "Path"}</dt></div>
    </dl>

    <section class="report-section" aria-label="Operation metadata">
      <h3>Metadata</h3>
      <dl class="report-facts report-inset report-record">
        <dt>Name</dt><dd>{data.summary || "—"}</dd>
        <dt>Description</dt><dd>{data.description || "—"}</dd>
        <dt>Operation ID</dt><dd>{data.operationId}</dd>
        <dt>Catalog identifier</dt><dd>{operation.id}</dd>
        {#if !data.catalog.protocol}<dt>{serverUrls.length > 1 ? "Server URLs" : "Server URL"}</dt><dd>{#each serverUrls as url, index}{#if index}<br />{/if}{url}{:else}—{/each}</dd>{/if}
        <dt>File</dt><dd>{data.catalog.file}</dd>
        <dt>Catalog version</dt><dd>{data.catalog.version}</dd>
        {#if data.catalog.protocol}<dt>Protocol</dt><dd>JSON-RPC</dd>{:else}<dt>OpenAPI version</dt><dd>{data.catalog.openapi}</dd>{/if}
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
            <dl class="report-facts report-inset report-record"><dt>Name</dt><dd>{categoryLabel(group.name)}</dd><dt>Description</dt><dd>{group.description || "—"}</dd></dl>
          </li>
        {/each}</ol>
      </section>
    {/if}

    <section class="report-section" aria-label="Operation JSON schema">
      <h3>Operation JSON schema</h3>
      {#if data.warnings.length}<ul class="schema-warnings" role="status">{#each data.warnings as warning}<li>{warning}</li>{/each}</ul>{/if}
      <JsonSchemaView value={data.schema} label={data.catalog.protocol ? "Operation JSON-RPC schema" : "Operation OpenAPI JSON"} />
    </section>
  {:else}<p role="alert" class="error">{report.error}</p>{/if}
</section>

<style>
  .report-metric-value { font-size: clamp(16px, 1.7vw, 22px); font-weight: 700; }
  .report-groups { margin: 0; padding: 0; list-style: none; }
  .report-groups li { position: relative; margin-left: calc(var(--group-depth) * 24px); }
  .report-groups li + li { margin-top: 14px; }
  .report-groups li + li::before { position: absolute; content: ''; left: -12px; top: -14px; bottom: calc(50% - 1px); width: 12px; border-left: 2px solid var(--color-border); border-bottom: 2px solid var(--color-border); border-bottom-left-radius: 4px; }
  .schema-warnings { padding-left: 20px; color: var(--color-accent); font-size: 12px; overflow-wrap: anywhere; }
  @media (max-width: 599px) { .report-groups li { margin-left: calc(var(--group-depth) * 16px); } }
</style>
