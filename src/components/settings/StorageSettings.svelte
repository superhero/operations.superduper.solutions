<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount } from "svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import { collectStorageReport } from "$lib/storage-metrics.ts";
  import { formatLocalDate, formatLocalDateTime as date } from "$lib/datetime.ts";
  import type { StorageReport, StorageCommit } from "$lib/storage-metrics-types.d.ts";

  let report = $state<StorageReport | null>(null);
  let busy = $state(false);
  let error = $state("");
  let alive = true;
  const readableRepositories = $derived(report?.repositories.items.filter(entry => entry.metrics !== null) ?? []);
  const repositoryBytes = $derived(readableRepositories.reduce((total, entry) => total + entry.metrics!.repositoryBytes, 0));
  const databaseRecords = $derived(report?.indexedDB.databases.reduce((total, database) => total + database.stores.reduce((count, store) => count + store.records, 0), 0) ?? 0);
  const recordsReadable = $derived(Boolean(report?.indexedDB.available && report.indexedDB.enumeration !== "unavailable" && (!report.indexedDB.databases.length || report.indexedDB.databases.some(database => !database.error || database.stores.length))));
  const number = (value: number) => value.toLocaleString();
  const percentage = (value: number) => value > 0 && value < 0.001 ? "<0.1%" : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  const fraction = (part: number, total: number) => total > 0 ? Math.max(0, Math.min(100, part / total * 100)) : 0;
  const keyPath = (value: string | string[] | null) => value === null ? "Out of line" : Array.isArray(value) ? value.join(", ") : value;

  function bytes(value: number | null): string
  {
    if (value === null || !Number.isFinite(value)) return "Unavailable";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const index = value > 0 ? Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
    return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
  }

  async function refresh()
  {
    if (busy) return;
    busy = true;
    error = "";
    try
    {
      const next = await collectStorageReport();
      if (alive) report = next;
    }
    catch (cause)
    {
      if (alive) error = cause instanceof Error ? cause.message : "Storage information could not be read.";
    }
    finally { if (alive) busy = false; }
  }

  onMount(() => {
    void refresh();
    return () => { alive = false; };
  });
</script>

{#snippet commitDetails(commit: StorageCommit)}
  <dl class="metadata">
    <dt>Commit</dt><dd><code>{commit.oid}</code></dd>
    <dt>Message</dt><dd class="commit-message">{commit.message}</dd>
    <dt>Date</dt><dd><time datetime={new Date(commit.timestamp).toISOString()}>{date(commit.timestamp)}</time></dd>
    <dt>Author</dt><dd>{commit.author}</dd>
    <dt>Committer</dt><dd>{commit.committer}</dd>
    <dt>Parents</dt><dd>{#if commit.parents.length}{#each commit.parents as parent (parent)}<code class="block-value">{parent}</code>{/each}{:else}None — initial commit{/if}</dd>
  </dl>
{/snippet}

<section class="storage-dashboard" aria-label="Storage dashboard" aria-busy={busy}>
  <header class="dashboard-header">
    <p class="updated">{#if report}Updated <time datetime={new Date(report.collectedAt).toISOString()}>{date(report.collectedAt)}</time>{:else}A snapshot of this website’s browser storage{/if}</p>
    <HintButton class="refresh-storage" label="Refresh storage metrics" aria-label="Refresh storage metrics" disabled={busy} onclick={refresh}>
      <MaterialIcon name="refresh" size={20} />
    </HintButton>
  </header>
  {#if busy}<p class="loading" role="status">{report ? "Refreshing storage information…" : "Reading storage information…"}</p>{/if}
  {#if error}<p class="storage-error" role="alert">{error} Use refresh to try again.</p>{/if}

  {#if report}
    <section class="storage-card" aria-label="Browser storage">
      <div class="card-heading"><h3>Browser storage</h3><MaterialIcon name="storage" size={22} /></div>
      <p class="explanation">Estimates for this website, including databases and browser caches.</p>
      <dl class="metric-grid">
        <div><dt>Used</dt><dd>{bytes(report.browser.usage)}</dd></div>
        <div><dt>Quota</dt><dd>{bytes(report.browser.quota)}</dd></div>
        <div><dt>Remaining</dt><dd>{bytes(report.browser.remaining)}</dd></div>
        <div><dt>Persistence</dt><dd class="persistence">{report.browser.persisted === null ? "Unavailable" : report.browser.persisted ? "Persistent" : "Best effort"}</dd></div>
      </dl>
      {#if report.browser.utilization !== null}
        <div class="meter-heading"><strong>{percentage(report.browser.utilization)} used</strong><span>of the browser’s estimated quota</span></div>
        <meter class="usage-meter" min="0" max="1" value={Math.min(1, Math.max(0, report.browser.utilization))} aria-label="Estimated storage utilization">{percentage(report.browser.utilization)}</meter>
      {:else}<p class="unavailable">Storage utilization unavailable.</p>{/if}
      <p class="explanation persistence-note">{report.browser.persisted === true ? "The browser has granted persistent storage for this website." : report.browser.persisted === false ? "The browser may clear best-effort storage when space is needed." : "The browser could not report whether storage is persistent."}</p>
      {#if report.browser.estimateError}<p class="storage-error" role="alert">{report.browser.estimateError}</p>{/if}
      {#if report.browser.persistenceError}<p class="storage-error" role="alert">{report.browser.persistenceError}</p>{/if}
      {#if report.browser.breakdown !== null}
        <details class="nested-details">
          <summary>Usage by storage type</summary>
          {#if report.browser.breakdown.length}
            {@const largest = Math.max(...report.browser.breakdown.map(item => item.bytes), 1)}
            <ul class="measure-list">{#each report.browser.breakdown as item (item.name)}
              <li><div class="measure-label"><strong>{item.name}</strong><span>{bytes(item.bytes)}</span></div><div class="thin-bar" aria-hidden="true"><span style:width={`${fraction(item.bytes, largest)}%`}></span></div></li>
            {/each}</ul>
            <p class="explanation">Browser-reported estimates, compared with the largest storage type.</p>
          {:else}<p class="explanation">The browser returned no storage-type breakdown.</p>{/if}
        </details>
      {:else}<p class="explanation persistence-note">Storage-type breakdown unavailable.</p>{/if}
    </section>

    <section class="storage-card" aria-label="IndexedDB databases">
      <div class="card-heading"><h3>IndexedDB databases</h3><MaterialIcon name="database" size={22} /></div>
      <p class="explanation">Exact record counts when readable. Records are not byte sizes.</p>
      <dl class="metric-grid compact-metrics">
        <div><dt>Databases inspected</dt><dd>{report.indexedDB.enumeration === "unavailable" ? "Unavailable" : number(report.indexedDB.databases.length)}</dd></div>
        <div><dt>Readable records</dt><dd>{recordsReadable ? number(databaseRecords) : "Unavailable"}</dd></div>
      </dl>
      <p class="explanation">{!report.indexedDB.available ? "IndexedDB is unavailable in this browser." : report.indexedDB.enumeration === "complete" ? "All databases reported by the browser are listed." : report.indexedDB.enumeration === "known" ? "This browser cannot list every database; known application databases are shown." : "The browser could not enumerate databases."}</p>
      {#if report.indexedDB.error}<p class="storage-error" role="alert">{report.indexedDB.error}</p>{/if}
      <div class="detail-list">
        {#each report.indexedDB.databases as database (database.name)}
          {@const largestStore = Math.max(...database.stores.map(store => store.records), 1)}
          <details class="entry-details database-entry">
            <summary><span class="entry-name">{database.name}</span><span class="summary-value">{database.error ? "Partly unavailable" : `${database.stores.length} store${database.stores.length === 1 ? "" : "s"}`}</span></summary>
            <div class="entry-content">
              <dl class="metadata"><dt>Database</dt><dd>{database.name}</dd><dt>Version</dt><dd>{database.version ?? "Unavailable"}</dd><dt>Object stores</dt><dd>{database.error && !database.stores.length ? "Unavailable" : database.stores.length}</dd></dl>
              {#if database.error}<p class="storage-error" role="alert">{database.error}</p>{/if}
              {#each database.stores as store (store.name)}
                <details class="nested-details store-entry">
                  <summary><span class="entry-name">{store.name}</span><span class="summary-value">{number(store.records)} records</span></summary>
                  <div class="thin-bar" aria-hidden="true"><span style:width={`${fraction(store.records, largestStore)}%`}></span></div>
                  <dl class="metadata"><dt>Records</dt><dd>{number(store.records)}</dd><dt>Key path</dt><dd><code>{keyPath(store.keyPath)}</code></dd><dt>Auto-increment</dt><dd>{store.autoIncrement ? "Yes" : "No"}</dd><dt>Indexes</dt><dd>{store.indexes.length}</dd></dl>
                  {#each store.indexes as index (index.name)}
                    <details class="nested-details index-entry"><summary>Index: {index.name}</summary><dl class="metadata"><dt>Name</dt><dd>{index.name}</dd><dt>Key path</dt><dd><code>{keyPath(index.keyPath)}</code></dd><dt>Unique</dt><dd>{index.unique ? "Yes" : "No"}</dd><dt>Multi-entry</dt><dd>{index.multiEntry ? "Yes" : "No"}</dd></dl></details>
                  {/each}
                </details>
              {/each}
              {#if database.stores.length}<p class="explanation">Bars compare record counts within this database.</p>{:else if !database.error}<p class="explanation">This database has no object stores.</p>{/if}
            </div>
          </details>
        {/each}
      </div>
      {#if !report.indexedDB.databases.length && report.indexedDB.enumeration !== "unavailable"}<p class="empty-state">No databases found.</p>{/if}
    </section>

    <section class="storage-card" aria-label="Workflow repositories">
      <div class="card-heading"><h3>Workflow repositories</h3><MaterialIcon name="account_tree" size={22} /></div>
      <p class="explanation">Logical file sizes inside each repository, including Git history. These are separate from the browser’s physical storage estimate.</p>
      <dl class="metric-grid compact-metrics">
        <div><dt>Workflows</dt><dd>{report.repositories.error && !report.repositories.items.length ? "Unavailable" : number(report.repositories.items.length)}</dd></div>
        <div><dt>Readable repository data</dt><dd>{!readableRepositories.length && (report.repositories.error || report.repositories.items.length) ? "Unavailable" : bytes(repositoryBytes)}</dd></div>
      </dl>
      {#if report.repositories.error}<p class="storage-error" role="alert">{report.repositories.error}</p>{/if}
      <div class="detail-list">
        {#each report.repositories.items as entry (entry.id)}
          <details class="entry-details repository-entry">
            <summary><span class="entry-name">{entry.name}</span><span class="summary-value">{entry.metrics ? bytes(entry.metrics.repositoryBytes) : "Unavailable"}</span></summary>
            <section class="entry-content" aria-label={`${entry.name} repository details`}>
              <dl class="metadata"><dt>Workflow ID</dt><dd><code>{entry.id}</code></dd><dt>Repository path</dt><dd><code>{entry.repositoryPath}</code></dd></dl>
              {#if entry.error}<p class="storage-error" role="alert">{entry.error}</p>{/if}
              {#if entry.metrics}
                {@const metrics = entry.metrics}
                {@const mostActive = Math.max(...metrics.activity.map(day => day.count), 1)}
                <div class="repository-size" aria-label="Logical repository size">
                  <div class="stacked-bar" aria-hidden="true"><span class="history-size" style:width={`${fraction(metrics.gitBytes, metrics.repositoryBytes)}%`}></span><span class="working-size" style:width={`${fraction(metrics.workingTreeBytes, metrics.repositoryBytes)}%`}></span></div>
                  <dl class="size-legend"><div><dt><span class="swatch history-size" aria-hidden="true"></span>Git metadata/history</dt><dd>{bytes(metrics.gitBytes)}</dd></div><div><dt><span class="swatch working-size" aria-hidden="true"></span>Working files</dt><dd>{bytes(metrics.workingTreeBytes)}</dd></div><div><dt>Total</dt><dd>{bytes(metrics.repositoryBytes)}</dd></div></dl>
                </div>
                <dl class="metadata"><dt>Current branch</dt><dd>{metrics.branch ?? "Detached HEAD"}</dd><dt>HEAD</dt><dd>{#if metrics.head}<code>{metrics.head}</code>{:else}No commits{/if}</dd><dt>Commits</dt><dd>{number(metrics.commitCount)}</dd><dt>Status</dt><dd>{metrics.status.clean ? "Clean" : "Changes present"}</dd><dt>Modified</dt><dd>{metrics.status.modified}</dd><dt>Staged</dt><dd>{metrics.status.staged}</dd><dt>Untracked</dt><dd>{metrics.status.untracked}</dd><dt>Deleted</dt><dd>{metrics.status.deleted}</dd></dl>
                <p class="explanation">A file can appear in more than one status count.</p>
                <details class="nested-details"><summary>Branches, tags and remotes</summary>
                  <dl class="reference-counts"><div><dt>Branch count</dt><dd>{number(metrics.branches.length)}</dd></div><div><dt>Tag count</dt><dd>{number(metrics.tags.length)}</dd></div><div><dt>Remote count</dt><dd>{number(metrics.remotes.length)}</dd></div></dl>
                  <dl class="metadata"><dt>Branches</dt><dd>{#if metrics.branches.length}{#each metrics.branches as branch (branch)}<code class="block-value">{branch}</code>{/each}{:else}None{/if}</dd><dt>Tags</dt><dd>{#if metrics.tags.length}{#each metrics.tags as tag (tag)}<code class="block-value">{tag}</code>{/each}{:else}None{/if}</dd><dt>Remotes</dt><dd>{#if metrics.remotes.length}{#each metrics.remotes as remote (remote.name)}<div class="remote"><strong>{remote.name}</strong><code>{remote.url}</code></div>{/each}{:else}None configured{/if}</dd></dl>
                </details>
                <details class="nested-details"><summary>Files <span class="summary-value">{metrics.trackedFiles.length} tracked</span></summary>
                  {#if metrics.trackedFiles.length}<ul class="file-list">{#each metrics.trackedFiles as file (file)}<li><code>{file}</code></li>{/each}</ul>{:else}<p class="explanation">No tracked files.</p>{/if}
                  {#if metrics.workflowFile}<dl class="metadata"><dt>workflow.json</dt><dd>{bytes(metrics.workflowFile.bytes)}</dd><dt>Modified</dt><dd>{date(metrics.workflowFile.mtimeMs)}</dd><dt>Metadata changed</dt><dd>{date(metrics.workflowFile.ctimeMs)}</dd></dl>{:else}<p class="explanation">workflow.json is unavailable.</p>{/if}
                </details>
                {#if metrics.latest}<details class="nested-details"><summary>Latest commit <span class="summary-value">{metrics.latest.oid.slice(0, 7)}</span></summary>{@render commitDetails(metrics.latest)}</details>{/if}
                <details class="nested-details"><summary>Recent commits <span class="summary-value">{metrics.recent.length}</span></summary>
                  {#each metrics.recent as commit (commit.oid)}<details class="nested-details"><summary><span class="entry-name">{commit.message}</span><code class="summary-value">{commit.oid.slice(0, 7)}</code></summary>{@render commitDetails(commit)}</details>{:else}<p class="explanation">No commits yet.</p>{/each}
                </details>
                <div class="activity" aria-label="30-day commit activity">
                  <p class="explanation activity-note">Commit counts include revisions reachable from HEAD. Daily activity uses committer dates in UTC.</p>
                  <div class="meter-heading"><strong>Last 30 days</strong><span>{number(metrics.activity.reduce((total, day) => total + day.count, 0))} commits</span></div>
                  <div class="activity-bars" aria-hidden="true">{#each metrics.activity as day (day.date)}<span title={`${formatLocalDate(day.date)}: ${day.count} commits`}><i style:height={`${fraction(day.count, mostActive)}%`}></i></span>{/each}</div>
                  {#if metrics.activity.length}<div class="activity-range"><span>{formatLocalDate(metrics.activity[0]!.date)}</span><span>{formatLocalDate(metrics.activity.at(-1)!.date)}</span></div>{/if}
                  <details class="nested-details"><summary>Daily commit counts</summary><dl class="daily-counts">{#each metrics.activity as day (day.date)}<div><dt>{formatLocalDate(day.date)}</dt><dd>{number(day.count)}</dd></div>{/each}</dl></details>
                </div>
              {/if}
            </section>
          </details>
        {/each}
      </div>
      {#if !report.repositories.items.length && !report.repositories.error}<p class="empty-state">No workflows are saved yet. Add operations to a workflow to start its local history.</p>{/if}
    </section>
  {/if}
</section>

<style>
  .storage-dashboard { display: grid; gap: 16px; min-width: 0; padding: 4px 16px 16px; color: var(--color-catalog-active-foreground); font-size: 12px; }
  .dashboard-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .updated { font-size: 11px; }
  .storage-dashboard :global(.refresh-storage) { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 4px; background: var(--color-muted); color: var(--color-catalog-foreground); }
  .storage-dashboard :global(.refresh-storage:disabled) { color: var(--color-disabled-foreground); }
  .storage-card { min-width: 0; padding: 18px; border-radius: 4px; background: var(--color-muted); color: var(--color-foreground); }
  .card-heading, .meter-heading, .measure-label { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  .card-heading { margin-bottom: 6px; }
  .card-heading :global(.material-symbols-rounded) { color: var(--color-badge-background); }
  h3 { margin: 0; font-size: 16px; font-weight: 700; }
  p { margin: 0; line-height: 1.6; }
  .explanation { color: var(--color-muted-foreground); font-size: 11px; line-height: 1.6; }
  .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
  .metric-grid > div { min-width: 0; padding-left: 10px; border-left: 2px solid var(--color-badge-background); }
  dt { font-weight: 700; }
  .metric-grid dt { margin-bottom: 5px; font-size: 11px; color: var(--color-muted-foreground); }
  dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .metric-grid dd { font-size: clamp(16px, 2vw, 21px); font-weight: 700; line-height: 1.3; }
  .metric-grid .persistence { font-size: 15px; }
  .compact-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .meter-heading { margin-bottom: 7px; font-size: 11px; }
  .meter-heading > span { color: var(--color-muted-foreground); }
  .usage-meter { display: block; width: 100%; height: 12px; border: 0; border-radius: 4px; overflow: hidden; background: var(--color-surface); }
  .usage-meter::-webkit-meter-bar { height: 12px; border: 0; border-radius: 4px; background: var(--color-surface); box-shadow: none; }
  .usage-meter::-webkit-meter-optimum-value { background: var(--color-badge-background); }
  .usage-meter::-moz-meter-bar { background: var(--color-badge-background); }
  .persistence-note { margin-top: 10px; }
  .unavailable, .empty-state { margin-top: 12px; color: var(--color-muted-foreground); }
  .storage-error { margin-top: 10px; padding: 10px 12px; border-left: 2px solid currentColor; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); overflow-wrap: anywhere; }
  .detail-list { display: grid; gap: 10px; margin-top: 16px; }
  .entry-details { min-width: 0; border: 1px solid var(--color-surface); border-radius: 4px; }
  summary { min-width: 0; cursor: pointer; font-weight: 700; line-height: 1.6; overflow-wrap: anywhere; }
  summary::marker { color: var(--color-badge-background); }
  summary:focus-visible { outline-color: var(--color-foreground); outline-offset: -2px; }
  .entry-details > summary { padding: 12px; }
  .entry-name { min-width: 0; overflow-wrap: anywhere; }
  .summary-value { display: inline-block; flex-shrink: 0; margin-left: 8px; font-size: 11px; color: var(--color-muted-foreground); white-space: nowrap; }
  .entry-content { display: grid; gap: 14px; min-width: 0; padding: 0 12px 12px; }
  .metadata { display: grid; grid-template-columns: minmax(96px, 1fr) minmax(0, 2fr); gap: 7px 12px; margin: 0; line-height: 1.6; }
  .metadata > dt { color: var(--color-muted-foreground); }
  .metadata > dd { border-left: 1px solid var(--color-surface); padding-left: 12px; }
  code { font-size: 11px; overflow-wrap: anywhere; white-space: normal; }
  .commit-message { white-space: pre-wrap; }
  .block-value { display: block; }
  .remote { display: grid; gap: 2px; margin-bottom: 6px; }
  .reference-counts { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 12px 0; }
  .reference-counts > div { display: grid; gap: 4px; }
  .reference-counts dt { color: var(--color-muted-foreground); font-size: 11px; }
  .reference-counts dd { font-weight: 700; }
  .nested-details { min-width: 0; margin-top: 12px; border-top: 1px solid var(--color-surface); padding-top: 10px; }
  .entry-content > .nested-details { margin-top: 0; }
  .nested-details > summary { margin-bottom: 8px; }
  .nested-details > .metadata, .nested-details > .explanation { margin-top: 10px; }
  .measure-list { display: grid; gap: 12px; margin: 12px 0; padding: 0; list-style: none; }
  .measure-label { margin-bottom: 5px; }
  .thin-bar { height: 5px; border-radius: 4px; background: var(--color-surface); overflow: hidden; }
  .thin-bar > span { display: block; height: 100%; background: var(--color-badge-background); transition: width 180ms ease-in; }
  .stacked-bar { display: flex; height: 16px; overflow: hidden; border-radius: 4px; background: var(--color-surface); }
  .stacked-bar > span { height: 100%; transition: width 180ms ease-in; }
  .history-size { background: var(--color-badge-background); }
  .working-size { background: var(--color-emphasis); }
  .size-legend { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px 20px; margin: 10px 0 0; font-size: 11px; }
  .size-legend > div { display: grid; gap: 4px; }
  .size-legend dt { display: flex; align-items: center; gap: 6px; }
  .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
  .size-legend dd { font-weight: 700; }
  .file-list { display: grid; gap: 5px; padding-left: 18px; }
  .activity { min-width: 0; padding-top: 4px; }
  .activity-note { margin-bottom: 10px; }
  .activity-bars { display: flex; gap: 3px; height: 64px; border-bottom: 1px solid var(--color-surface); }
  .activity-bars > span { display: flex; align-items: flex-end; flex: 1; min-width: 0; height: 100%; }
  .activity-bars i { display: block; width: 100%; background: var(--color-badge-background); border-radius: 2px 2px 0 0; transition: height 180ms ease-in; }
  .activity-range { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--color-muted-foreground); font-size: 10px; }
  .daily-counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px 16px; margin: 10px 0 0; }
  .daily-counts > div { display: flex; justify-content: space-between; gap: 8px; }
  @media (max-width: 600px) {
    .storage-dashboard { padding: 4px 10px 12px; gap: 12px; }
    .storage-card { padding: 12px; }
    .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
    .metadata { grid-template-columns: minmax(70px, 1fr) minmax(0, 1.5fr); gap: 7px 8px; }
    .metadata > dd { padding-left: 8px; }
    .entry-details > summary { padding: 10px; }
    .entry-content { padding: 0 10px 10px; }
    .activity-bars { gap: 2px; }
  }
  @media (prefers-reduced-motion: reduce) { .thin-bar > span, .stacked-bar > span, .activity-bars i { transition: none; } }
</style>
