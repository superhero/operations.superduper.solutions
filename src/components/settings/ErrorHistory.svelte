<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { subscribeErrorHistory, showErrorHistoryPage, retryErrorHistory, type ErrorHistoryState } from "$lib/error-history.ts";
  import { errorHistoryPageSize, type ErrorDetail, type ErrorHistoryRecord } from "$lib/error-history-types.ts";
  import { formatLocalDateTime } from "$lib/datetime.ts";
  import HintButton from "$lib/components/HintButton.svelte";

  let history = $state<ErrorHistoryState>({ phase: "idle", entries: [], total: 0, offset: 0, error: null, queued: 0, dropped: 0, unconfirmed: 0 });
  let expanded = $state(new Set<number>());
  const origin = (entry: ErrorHistoryRecord) => [entry.origin.source, [entry.origin.scope, entry.origin.operation].filter(Boolean).join(" > ")].filter(Boolean).join(" · ");
  const number = (value: number) => value.toLocaleString();
  const location = (entry: ErrorHistoryRecord) => [entry.origin.filename, entry.origin.line, entry.origin.column].filter(value => value !== undefined).join(":");
  function toggle(id: number, open: boolean): void {
    const next = new Set(expanded);
    if (open) next.add(id); else next.delete(id);
    expanded = next;
  }
  onMount(() => subscribeErrorHistory(value => { history = value; }));
</script>

{#snippet diagnostic(detail: ErrorDetail)}
  <div class="diagnostic">
    <p><strong>{detail.name}</strong>{#if detail.code !== undefined} <code>{detail.code}</code>{/if}</p>
    <p class="message">{detail.message}</p>
    {#if detail.stack}<div class="entry-divider" aria-hidden="true"></div><pre>{detail.stack}</pre>{:else}<p class="muted">No stack trace available.</p>{/if}
    {#if detail.cause}<div class="cause"><h5>Caused by</h5>{@render diagnostic(detail.cause)}</div>{/if}
    {#if detail.errors?.length}
      <div class="cause"><h5>Related errors</h5>{#each detail.errors as child}{@render diagnostic(child)}{/each}</div>
    {/if}
  </div>
{/snippet}

<section class="error-history" aria-label="Errors" aria-busy={history.phase === "loading"}>
  <div class="heading">
    <h3>Errors</h3>
    {#if history.phase === "unavailable"}<HintButton label="Retry error history" class="retry" onclick={retryErrorHistory}><span class="material-symbols-outlined" aria-hidden="true">refresh</span></HintButton>{/if}
  </div>
  <dl class="metrics"><div><dt>Unique errors</dt><dd>{number(history.total)}</dd></div></dl>
  {#if history.error}<p class="failure" role="status">{history.error}</p>{/if}
  {#if history.unconfirmed}<p class="muted" role="status">{number(history.unconfirmed)} error occurrence{history.unconfirmed === 1 ? "" : "s"} could not be confirmed as saved.</p>{/if}
  {#if history.dropped}<p class="muted" role="status">{number(history.dropped)} error occurrence{history.dropped === 1 ? " was" : "s were"} not queued because the recorder was full.</p>{/if}
  {#if history.phase === "unavailable" && history.queued}<p class="muted">{number(history.queued)} unique error{history.queued === 1 ? " is" : "s are"} waiting for retry.</p>{/if}
  {#if history.entries.length}
    <div class="entries">
      {#each history.entries as entry (entry.id)}
        <details class="entry" ontoggle={event => toggle(entry.id, event.currentTarget.open)}>
          <summary>
            <span class="summary-text"><strong>{origin(entry)}</strong></span>
            <span class="occurrences">{number(entry.occurrences)} {entry.occurrences === 1 ? "occurrence" : "occurrences"}</span>
          </summary>
          {#if expanded.has(entry.id)}
            <div class="entry-content">
              <div class="entry-divider" aria-hidden="true"></div>
              <dl class="timestamps"><div><dt>First seen</dt><dd>{formatLocalDateTime(entry.firstSeen)}</dd></div><div><dt>Last seen</dt><dd>{formatLocalDateTime(entry.lastSeen)}</dd></div></dl>
              <div class="entry-divider" aria-hidden="true"></div>
              {#if entry.origin.filename}<p class="source">{location(entry)}</p>{/if}
              {@render diagnostic(entry.error)}
            </div>
          {/if}
        </details>
      {/each}
    </div>
    {#if history.total > errorHistoryPageSize}
      <nav aria-label="Error history pages">
        <HintButton label="Newer errors" class="page-button" disabled={history.offset === 0} onclick={() => showErrorHistoryPage(history.offset - errorHistoryPageSize)}><span class="material-symbols-outlined" aria-hidden="true">chevron_left</span></HintButton>
        <span>{number(history.offset + 1)}–{number(history.offset + history.entries.length)} of {number(history.total)}</span>
        <HintButton label="Older errors" class="page-button" disabled={history.offset + errorHistoryPageSize >= history.total} onclick={() => showErrorHistoryPage(history.offset + errorHistoryPageSize)}><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></HintButton>
      </nav>
    {/if}
  {:else if history.phase === "ready"}<p class="muted">No errors recorded.</p>
  {:else if history.phase !== "unavailable"}<p class="muted" role="status">Loading error history…</p>{/if}
</section>

<style>
  .error-history { min-width: 0; padding: 18px; border-radius: 4px; background: var(--color-surface); color: var(--color-foreground); }
  .heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  h3 { margin: 0; font-size: 16px; }
  p { margin: 8px 0; }
  .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 0 16px; }
  .metrics > div { min-width: 0; padding: 8px 10px; border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-background); }
  dt { color: var(--color-muted-foreground); font-size: 11px; font-weight: 400; }
  dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  .metrics dd { font-size: clamp(16px, 2vw, 21px); font-weight: 700; }
  .muted { color: var(--color-muted-foreground); font-size: 12px; }
  .entries { display: grid; gap: 8px; min-width: 0; }
  .entry { min-width: 0; border-radius: 4px; background: var(--color-background); }
  summary { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px; cursor: pointer; }
  summary::before { content: "›"; flex: 0 0 auto; transition: transform 200ms ease; }
  .entry[open] > summary::before { transform: rotate(90deg); }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--color-foreground); outline-offset: 2px; border-radius: 4px; }
  .summary-text { display: grid; gap: 4px; flex: 1; min-width: 0; }
  .summary-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .summary-text .muted { overflow-wrap: anywhere; }
  .occurrences { flex: 0 0 auto; color: var(--color-muted-foreground); font-size: 11px; }
  .entry-content { min-width: 0; padding: 0 12px 12px; }
  .entry-divider { height: 1px; margin: 8px 0; background: repeating-linear-gradient(to right, var(--color-surface) 0 8px, transparent 8px 14px); }
  .timestamps { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 0 0 12px; font-size: 12px; }
  .diagnostic { min-width: 0; margin-top: 12px; font-size: 12px; }
  .diagnostic code { margin-left: 8px; color: var(--color-muted-foreground); font-size: 11px; }
  .message, .source { overflow-wrap: anywhere; white-space: pre-wrap; }
  pre { max-width: 100%; margin: 8px 0; overflow: auto; font-size: 11px; }
  .cause { margin-top: 12px; padding-left: 12px; border-left: 2px solid var(--color-surface); }
  h5 { margin: 0; font-size: 12px; }
  .failure { padding: 10px 12px; border-left: 2px solid currentColor; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); overflow-wrap: anywhere; }
  nav { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 12px; color: var(--color-muted-foreground); font-size: 11px; }
  :global(.error-history .retry), :global(.error-history .page-button) { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  @media (max-width: 600px) { .error-history { padding: 12px; } .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } summary { gap: 8px; } .occurrences { max-width: 80px; text-align: right; } }
  @media (prefers-reduced-motion: reduce) { summary::before { transition: none; } }
</style>
