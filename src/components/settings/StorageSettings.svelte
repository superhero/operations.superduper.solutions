<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { subscribeMetricsRecorder } from "$lib/metrics-recorder.ts";
  import type { RecorderState } from "$lib/metrics-recorder-types.ts";
  import { metricSeries } from "$lib/metrics-series.ts";
  import MetricsHistoryChart from "./MetricsHistoryChart.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import { formatLocalDate } from "$lib/datetime.ts";

  let recorder = $state<RecorderState>({ phase: "starting", report: null, pageMemory: null, activeBar: null,
    bars: [], error: null, historyError: null });
  const report = $derived(recorder.report);
  const pageMemory = $derived(recorder.pageMemory);
  const processing = $derived(report?.processing);
  const busy = $derived(!report && recorder.phase !== "unavailable");
  const error = $derived(recorder.error);
  const series = $derived(metricSeries(recorder.bars, recorder.activeBar, report));
  const memoryGroups = $derived(pageMemory?.groups ?? []);
  const categoryTotal = $derived(memoryGroups.reduce((sum, group) => sum + group.bytes, 0));
  const compositionColors: Record<string, string> = {
    JavaScript: "var(--color-badge-background)",
    Shared: "var(--color-primary)",
    Canvas: "var(--color-background)",
    DOM: "var(--color-muted-foreground)"
  };
  const compositionColor = (label: string) => compositionColors[label] ?? "var(--color-foreground)";
  const readableRepositories = $derived(report?.repositories.items.filter(entry => entry.metrics !== null) ?? []);
  const repositoryBytes = $derived(readableRepositories.reduce((total, entry) => total + entry.metrics!.repositoryBytes, 0));
  const databaseRecords = $derived(report?.indexedDB.databases.reduce((total, database) => total + database.stores.reduce((count, store) => count + store.records, 0), 0) ?? 0);
  const databaseStores = $derived(report?.indexedDB.databases.reduce((total, database) => total + database.stores.length, 0) ?? 0);
  const partialDatabases = $derived(report?.indexedDB.databases.some(database => database.error) ?? false);
  const recordsReadable = $derived(Boolean(report?.indexedDB.available && report.indexedDB.enumeration !== "unavailable" && (!report.indexedDB.databases.length || report.indexedDB.databases.some(database => !database.error || database.stores.length))));
  const number = (value: number) => value.toLocaleString();
  const milliseconds = (value: number | null | undefined) => value == null ? "Unavailable" : value.toLocaleString(undefined, { style: "unit", unit: "millisecond", unitDisplay: "short", maximumFractionDigits: 1 });
  const percentage = (value: number) => value > 0 && value < 0.001 ? "<0.1%" : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  const fraction = (part: number, total: number) => total > 0 ? Math.max(0, Math.min(100, part / total * 100)) : 0;

  function bytes(value: number | null): string
  {
    if (value === null || !Number.isFinite(value)) return "Unavailable";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const index = value > 0 ? Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
    return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
  }

  onMount(() => subscribeMetricsRecorder(value => { recorder = value; }));
</script>

<section class="storage-dashboard" aria-label="Storage dashboard">
  {#if busy}<p class="loading" role="status">{recorder.phase === "collecting" ? "Collecting storage information…" : "Measuring application memory before collecting storage information…"}</p>{/if}
  {#if error}<p class="storage-error" role="alert">{error}</p>{/if}
  {#if recorder.historyError}<p class="storage-error" role="alert">{recorder.historyError}</p>{/if}

  <section class="storage-card" aria-label="Usage history">
    <MetricsHistoryChart bars={recorder.bars} activeBar={recorder.activeBar} {series} />
  </section>

  {#if report}
    <section class="storage-card" aria-label="Processing" aria-busy={busy}>
      <div class="card-heading"><h3>Processing</h3></div>
      <dl class="metric-grid">
        <div><dt>Threads</dt><dd>{report.execution.threads == null ? "Unavailable" : number(report.execution.threads)}</dd></div>
        <div><dt>Long tasks</dt><dd>{processing?.longTasks == null ? "Unavailable" : number(processing.longTasks)}</dd></div>
        <div><dt>Long-task time</dt><dd>{milliseconds(processing?.longTaskTime)}</dd></div>
        <div><dt>Blocking time</dt><dd>{milliseconds(processing?.blockingTime)}</dd></div>
      </dl>
      {#if processing?.error}<p class="unavailable">{processing.error}</p>{/if}
    </section>

    <section class="storage-card" aria-label="Memory" aria-busy={busy}>
      <div class="card-heading"><h3>Memory</h3></div>
      <dl class="metric-grid">
        <div><dt>Used heap</dt><dd>{bytes(report.memory.used)}</dd></div>
        <div><dt>Allocated heap</dt><dd>{bytes(report.memory.allocated)}</dd></div>
        <div><dt>Heap limit</dt><dd>{bytes(report.memory.limit)}</dd></div>
        {#if pageMemory && pageMemory.total !== null}
          <div><dt>Total measured</dt><dd>{bytes(pageMemory.total)}</dd></div>
          {#each memoryGroups as group}
            <div><dt>{group.label}</dt><dd>{bytes(group.bytes)}</dd></div>
          {/each}
        {/if}
      </dl>
      {#if report.memory.utilization !== null}
        <div class="meter-heading"><strong>{percentage(report.memory.utilization)} used</strong><span>of the currently allocated heap</span></div>
        <meter class="usage-meter" min="0" max="1" value={Math.min(1, Math.max(0, report.memory.utilization))} aria-label="JavaScript heap utilization">{percentage(report.memory.utilization)}</meter>
      {/if}
      {#if report.memory.error}<p class="storage-error" role="alert">{report.memory.error}</p>
      {:else if report.memory.used === null}<p class="unavailable">Heap measurements are unavailable in this browser.</p>{/if}
      {#if pageMemory}
        {#if pageMemory.total !== null}
          {#if categoryTotal > 0 && pageMemory.total > 0}
            <div class="memory-composition" role="img" aria-label={memoryGroups.map(group => `${group.label}: ${percentage(group.bytes / pageMemory.total!)}`).join(", ")}>
              {#each memoryGroups as group}
                <span style:flex-grow={group.bytes} style:background={compositionColor(group.label)} title={`${group.label}: ${bytes(group.bytes)} · ${percentage(group.bytes / pageMemory.total!)}`}></span>
              {/each}
            </div>
            <ul class="memory-legend">
              {#each memoryGroups as group}
                <li><i style:background={compositionColor(group.label)}></i>{group.label} <strong>{percentage(group.bytes / pageMemory.total!)}</strong></li>
              {/each}
            </ul>
          {/if}
        {:else if pageMemory.unavailable}<p class="unavailable">{pageMemory.unavailable}</p>{/if}
        {#if pageMemory.error}<p class="storage-error" role="alert">{pageMemory.error}</p>{/if}
      {/if}
    </section>

    <section class="storage-card" aria-label="Storage" aria-busy={busy}>
      <div class="card-heading"><h3>Storage</h3></div>
      <dl class="metric-grid browser-metrics">
        <div><dt>Used</dt><dd>{bytes(report.browser.usage)}</dd></div>
        <div><dt>Quota</dt><dd>{bytes(report.browser.quota)}</dd></div>
        <div><dt>Persistence</dt><dd class="persistence">{report.browser.persisted === null ? "Unavailable" : report.browser.persisted ? "Persistent" : "Best effort"}</dd></div>
        <div><dt>Databases</dt><dd>{report.indexedDB.enumeration === "unavailable" ? "Unavailable" : number(report.indexedDB.databases.length)}</dd></div>
        <div><dt>{partialDatabases ? "Readable stores" : "Object stores"}</dt><dd>{recordsReadable ? number(databaseStores) : "Unavailable"}</dd></div>
        <div><dt>{partialDatabases ? "Readable records" : "Records"}</dt><dd>{recordsReadable ? number(databaseRecords) : "Unavailable"}</dd></div>
      </dl>
      {#if report.browser.utilization !== null}
        <div class="meter-heading"><strong>{percentage(report.browser.utilization)} used</strong><span>of the browser’s estimated quota</span></div>
        <meter class="usage-meter" min="0" max="1" value={Math.min(1, Math.max(0, report.browser.utilization))} aria-label="Estimated storage utilization">{percentage(report.browser.utilization)}</meter>
      {:else}<p class="unavailable">Storage utilization unavailable.</p>{/if}
      {#if report.browser.persisted !== true}
        <p class="explanation persistence-note">{report.browser.persisted === false ? "The browser may clear best-effort storage when space is needed." : "The browser could not report whether storage is persistent."}</p>
      {/if}
      {#if report.browser.estimateError}<p class="storage-error" role="alert">{report.browser.estimateError}</p>{/if}
      {#if report.browser.persistenceError}<p class="storage-error" role="alert">{report.browser.persistenceError}</p>{/if}

      <div class="database-heading"><h4>Records by database</h4></div>
      {#if report.indexedDB.enumeration !== "complete"}
        <p class="explanation">{!report.indexedDB.available ? "IndexedDB is unavailable in this browser." : report.indexedDB.enumeration === "known" ? "Showing known application databases only." : "The browser could not enumerate databases."}</p>
      {/if}
      {#if report.indexedDB.error}<p class="storage-error" role="alert">{report.indexedDB.error}</p>{/if}
      <div class="database-metrics">
        {#each report.indexedDB.databases as database (database.name)}
          {@const recordCount = database.stores.reduce((sum, store) => sum + store.records, 0)}
          <div class="entry-details database-entry" role="group" aria-label={database.name}>
            <HintButton label={database.name} labelAsName={false}>
              {#snippet child({ props })}
                {@const { type: _type, ...hintProps } = props}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the full database name.) -->
                <span {...hintProps} class="database-name" tabindex="0">{database.name}</span>
              {/snippet}
            </HintButton>
            <span class="database-count">{database.error && !database.stores.length ? "Unavailable" : number(recordCount)}</span>
            <span class="database-unit">{database.error ? "Readable records" : "Records"}</span>
            {#if database.error}<p class="storage-error" role="alert">{database.error}</p>{/if}
          </div>
        {/each}
      </div>
      {#if !report.indexedDB.databases.length && report.indexedDB.enumeration !== "unavailable"}<p class="empty-state">No databases found.</p>{/if}
    </section>

    <section class="storage-card" aria-label="Git filesystem" aria-busy={busy}>
      <div class="card-heading"><h3>Git filesystem</h3></div>
      <dl class="metric-grid compact-metrics">
        <div><dt>Repositories</dt><dd>{report.repositories.error && !report.repositories.items.length ? "Unavailable" : number(report.repositories.items.length)}</dd></div>
        <div><dt>Readable repository data</dt><dd>{!readableRepositories.length && (report.repositories.error || report.repositories.items.length) ? "Unavailable" : bytes(repositoryBytes)}</dd></div>
      </dl>
      {#if report.repositories.error}<p class="storage-error" role="alert">{report.repositories.error}</p>{/if}
      <div class="detail-list">
        {#each report.repositories.items as entry (entry.id)}
          <div class="entry-details repository-entry">
            <header class="repository-heading"><h4 class="entry-name">{entry.name}</h4><span class="summary-value">{entry.metrics ? bytes(entry.metrics.repositoryBytes) : "Unavailable"}</span></header>
            <section class="entry-content" aria-label={`${entry.name} repository details`}>
              {#if entry.error}<p class="storage-error" role="alert">{entry.error}</p>{/if}
              {#if entry.metrics}
                {@const metrics = entry.metrics}
                {@const mostActive = Math.max(...metrics.activity.map(day => day.count), 1)}
                <div class="repository-size" aria-label="Logical repository size">
                  <div class="stacked-bar" aria-hidden="true"><span class="history-size" style:width={`${fraction(metrics.gitBytes, metrics.repositoryBytes)}%`}></span><span class="working-size" style:width={`${fraction(metrics.workingTreeBytes, metrics.repositoryBytes)}%`}></span></div>
                  <dl class="size-legend"><div><dt><span class="swatch history-size" aria-hidden="true"></span>Git metadata/history</dt><dd>{bytes(metrics.gitBytes)}</dd></div><div><dt><span class="swatch working-size" aria-hidden="true"></span>Working files</dt><dd>{bytes(metrics.workingTreeBytes)}</dd></div></dl>
                </div>
                <div class="activity" aria-label={`${metrics.activity.length}-day commit activity`}>
                  <div class="activity-bars" aria-hidden="true">{#each metrics.activity as day (day.date)}<span><i style:height={`${fraction(day.count, mostActive)}%`}></i></span>{/each}</div>
                  <div class="activity-grid" role="group" aria-label="Daily commit counts">
                    {#each metrics.activity as day (day.date)}
                      <HintButton label={`${formatLocalDate(day.date)}: ${number(day.count)} ${day.count === 1 ? "commit" : "commits"}`}>
                        {#snippet child({ props })}
                          {@const { type: _type, ...hintProps } = props}
                          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the date and commit count.) -->
                          <span {...hintProps} role="img" class="activity-day" tabindex="0" style:--intensity={`${fraction(day.count, mostActive)}%`}></span>
                        {/snippet}
                      </HintButton>
                    {/each}
                  </div>
                  <div class="activity-footer">
                    <div class="activity-scale" aria-label="Color intensity: zero to busiest day">
                      <span>0%</span>
                      {#each [0, 25, 50, 75, 100] as intensity}<i style:--intensity={`${intensity}%`} aria-hidden="true"></i>{/each}
                      <span>100% · busiest day</span>
                    </div>
                    <span class="activity-summary">Last {metrics.activity.length} days · {number(metrics.activity.reduce((total, day) => total + day.count, 0))} commits</span>
                  </div>
                </div>
              {/if}
            </section>
          </div>
        {/each}
      </div>
      {#if !report.repositories.items.length && !report.repositories.error}<p class="empty-state">No repositories to display yet.</p>{/if}
    </section>
  {/if}
</section>

<style>
  .storage-dashboard { display: grid; gap: 16px; min-width: 0; padding: 4px 16px 16px; color: var(--color-catalog-active-foreground); font-size: 12px; }
  .storage-card { min-width: 0; padding: 18px; border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); }
  .card-heading, .meter-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  .card-heading { margin-bottom: 6px; }
  h3 { margin: 0; font-size: 16px; font-weight: 700; }
  .database-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; margin: 24px 0 8px; }
  .database-heading h4 { margin: 0; font-size: 12px; font-weight: 700; }
  .database-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 12px; align-items: start; }
  .entry-details.database-entry { display: grid; gap: 4px; padding: 8px 10px; border: 0; border-left: 2px solid var(--color-badge-background); background: var(--color-background); }
  .database-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
  .database-count { font-size: clamp(16px, 2vw, 21px); font-weight: 700; line-height: 1.3; }
  .database-unit { font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
  p { margin: 0; line-height: 1.6; }
  .explanation { color: var(--color-muted-foreground); font-size: 11px; line-height: 1.6; }
  .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
  .metric-grid > div { min-width: 0; padding-block: 8px; padding-left: 10px; border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-background); }
  dt { font-weight: 700; }
  .metric-grid dt { margin-bottom: 5px; font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
  dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .metric-grid dd { font-size: clamp(16px, 2vw, 21px); font-weight: 700; line-height: 1.3; }
  .compact-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .browser-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .memory-composition { display: flex; height: 5px; margin-top: 12px; border-radius: 4px; overflow: hidden; background: var(--color-background); }
  .memory-composition span { flex-basis: 0; }
  .memory-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 0; margin: 10px 0 16px; list-style: none; color: var(--color-muted-foreground); font-size: 11px; }
  .memory-legend li { display: flex; align-items: center; gap: 6px; }
  .memory-legend i { width: 9px; height: 9px; border-radius: 2px; }
  .meter-heading { margin-bottom: 7px; font-size: 11px; }
  .meter-heading > span { color: var(--color-muted-foreground); }
  .usage-meter { display: block; width: 100%; height: 5px; border: 0; border-radius: 4px; overflow: hidden; background: var(--color-background); }
  .usage-meter::-webkit-meter-bar { height: 5px; border: 0; border-radius: 4px; background: var(--color-background); box-shadow: none; }
  .usage-meter::-webkit-meter-optimum-value { background: var(--color-badge-background); }
  .usage-meter::-moz-meter-bar { background: var(--color-badge-background); }
  .persistence-note { margin-top: 10px; }
  .unavailable, .empty-state { margin-top: 12px; color: var(--color-muted-foreground); }
  .storage-error { margin-top: 10px; padding: 10px 12px; border-left: 2px solid currentColor; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); overflow-wrap: anywhere; }
  .detail-list { display: grid; gap: 10px; margin-top: 16px; }
  .entry-details { min-width: 0; border: 1px solid var(--color-surface); border-radius: 4px; }
  .entry-details.repository-entry { border: 0; }
  .repository-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .repository-heading h4 { margin: 0; font-size: inherit; }
  .repository-entry > .entry-content { padding: 0; }
  .entry-name { min-width: 0; overflow-wrap: anywhere; }
  .summary-value { display: inline-block; flex-shrink: 0; margin-left: 8px; font-size: 11px; color: var(--color-muted-foreground); white-space: nowrap; }
  .entry-content { display: grid; gap: 14px; min-width: 0; padding: 0 12px 12px; }
  .stacked-bar { display: flex; height: 5px; overflow: hidden; border-radius: 4px; background: var(--color-background); }
  .stacked-bar > span { height: 100%; transition: width 180ms ease-in; }
  .history-size { background: var(--color-badge-background); }
  .working-size { background: var(--color-emphasis); }
  .size-legend { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px 20px; margin: 10px 0 0; font-size: 11px; }
  .size-legend > div { display: grid; gap: 4px; }
  .size-legend dt { display: flex; align-items: center; gap: 6px; }
  .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
  .size-legend dd { font-weight: 700; }
  .activity { min-width: 0; border-top: 1px solid var(--color-background); padding-top: 16px; }
  .activity-bars { display: flex; gap: 3px; height: 64px; margin-bottom: 16px; }
  .activity-bars > span { display: flex; align-items: flex-end; flex: 1; min-width: 0; }
  .activity-bars i { display: block; width: 100%; background: var(--color-badge-background); border-radius: 2px 2px 0 0; transition: height 180ms ease; }
  .activity-grid { display: grid; grid-template-columns: repeat(auto-fill, 29px); justify-content: space-between; gap: 4px; }
  .activity-day, .activity-scale i { border-radius: 4px; background: color-mix(in srgb, var(--color-badge-background) var(--intensity), var(--color-background)); }
  .activity-day { display: block; aspect-ratio: 1; transition: background-color 200ms ease; }
  .activity-day:focus-visible { outline: 2px solid var(--color-foreground); outline-offset: 2px; }
  .activity-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; }
  .activity-summary { margin-left: auto; text-align: right; color: var(--color-muted-foreground); font-size: 10px; }
  .activity-scale { display: flex; align-items: center; gap: 4px; color: var(--color-muted-foreground); font-size: 10px; }
  .activity-scale > span:first-child { margin-right: 4px; }
  .activity-scale > span:last-child { margin-left: 4px; }
  .activity-scale i { width: 12px; height: 12px; }
  @media (max-width: 600px) {
    .storage-dashboard { padding: 4px 10px 12px; gap: 12px; }
    .storage-card { padding: 12px; }
    .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
    .database-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
    .entry-content { padding: 0 10px 10px; }
  }
  @media (prefers-reduced-motion: reduce) { .stacked-bar > span, .activity-bars i, .activity-day { transition: none; } }
</style>
