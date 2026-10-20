<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import Reveal from "$lib/components/Reveal.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import WorkflowHistory from "../workflows/WorkflowHistory.svelte";
  import type { SchemaBranchHistory, SchemaRevisionDiff } from "$lib/schema-storage.ts";
  import type { SchemaResolution } from "$lib/schema-merge.ts";

  let { id, sourceIdentity, pending = false, load, loadDiff, onResolve, onDismiss, onBundledUpdate }: {
    id: string;
    sourceIdentity: string;
    pending?: boolean | undefined;
    load: (limit: number) => Promise<SchemaBranchHistory>;
    loadDiff: (oid: string, limit: number, parent?: string) => Promise<SchemaRevisionDiff>;
    onResolve?: ((current: string, incoming: string, choices: Record<string, SchemaResolution>) => Promise<void>) | undefined;
    onDismiss?: ((current: string, incoming: string) => Promise<void>) | undefined;
    onBundledUpdate?: (() => Promise<void>) | undefined;
  } = $props();
  let open = $state(false);
  let history = $state<SchemaBranchHistory>();
  let diff = $state<SchemaRevisionDiff>();
  let selected = $state("");
  let comparison = $state<string>();
  let loading = $state(false);
  let loadingDiff = $state(false);
  let acting = $state(false);
  let error = $state("");
  let choices = $state<Record<string, SchemaResolution>>({});
  let historyLimit = $state(100);
  let diffLimit = $state(200);
  let generation = 0;
  let diffGeneration = 0;
  const revisions = $derived(history?.revisions.map(revision => ({ ...revision,
    branches: history!.branches.filter(branch => branch.oid === revision.oid).map(branch => branch.name) })) ?? []);
  const canResolve = $derived(Boolean(history?.incoming && history.incoming.conflicts.every(conflict => Object.hasOwn(choices, conflict.path))));
  const groups = $derived.by(() => {
    if (!diff) return [];
    const grouped = new Map<string, SchemaRevisionDiff["changes"]>();
    for (const change of diff.changes) {
      const category = /\/(security|x-upstream-security)$/.test(change.path) ? "Authentication"
        : change.path.startsWith("/info/") ? "Schema information"
        : change.path.startsWith("/paths/") ? "Operations"
        : change.path.startsWith("/components/") ? "Data models and definitions" : "Other fields";
      const entries = grouped.get(category) ?? [];
      entries.push(change);
      grouped.set(category, entries);
    }
    return [...grouped].map(([category, changes]) => {
      const correction = category === "Authentication" && diff!.revision.message === "Apply schema corrections: Google OAuth alternatives";
      const operations = changes.filter(change => /^\/paths\/[^/]+\/(get|put|post|delete|options|head|patch|trace)\/security$/.test(change.path)).length;
      const count = correction && operations ? `${operations} operation${operations === 1 ? "" : "s"} corrected` : `${changes.length} field${changes.length === 1 ? "" : "s"}`;
      return { label: correction ? "Google OAuth alternatives" : category, changes, correction,
        count: `${count}${diff!.truncated ? " shown" : ""}` };
    });
  });

  $effect(() => { if (pending) open = true; });
  $effect(() => {
    sourceIdentity;
    pending;
    if (open) untrack(() => { if (!acting) void refresh(); });
    else untrack(() => { generation++; diffGeneration++; history = undefined; diff = undefined; selected = ""; comparison = undefined; loadingDiff = false; });
  });
  onDestroy(() => { generation++; diffGeneration++; });

  async function select(oid: string, parent?: string) {
    const request = ++diffGeneration;
    if (oid !== selected || parent !== comparison) diffLimit = 200;
    loadingDiff = true;
    error = "";
    try {
      const next = await loadDiff(oid, diffLimit, parent);
      if (request === diffGeneration) { selected = oid; comparison = next.base?.oid; diff = next; }
    } catch (failure) { if (request === diffGeneration) error = failure instanceof Error ? failure.message : "Could not read schema changes."; }
    finally { if (request === diffGeneration) loadingDiff = false; }
  }

  async function refresh() {
    if (!open) return;
    const request = ++generation;
    loading = true;
    error = "";
    choices = {};
    try {
      const next = await load(historyLimit);
      if (request !== generation) return;
      history = next;
      if (next.revisions.some(revision => revision.oid === selected)) await select(selected, comparison);
      else await select(next.current);
    } catch (failure) { if (request === generation) error = failure instanceof Error ? failure.message : "Could not read schema history."; }
    finally { if (request === generation) loading = false; }
  }

  async function review(accept: boolean) {
    if (!history?.incoming || acting) return;
    const current = history.current;
    const incoming = history.incoming.revision;
    acting = true;
    error = "";
    try {
      if (accept && onResolve) await onResolve(current, incoming, { ...choices });
      else if (!accept && onDismiss) await onDismiss(current, incoming);
      selected = "";
      comparison = undefined;
      diff = undefined;
      await refresh();
    } catch (failure) { error = failure instanceof Error ? failure.message : "Could not apply the schema update."; }
    finally { acting = false; }
  }

  async function applyBundled() {
    if (!onBundledUpdate || acting) return;
    acting = true;
    error = "";
    try { await onBundledUpdate(); selected = ""; comparison = undefined; diff = undefined; await refresh(); }
    catch (failure) { error = failure instanceof Error ? failure.message : "Could not apply the bundled revision."; }
    finally { acting = false; }
  }

  function preview(value: unknown) {
    const text = JSON.stringify(value, null, 2) ?? "Missing";
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  }
</script>

{#snippet fields(changes: SchemaRevisionDiff["changes"])}
  {#each changes as change (change.path)}
    <details class="field-change">
      <summary><span class="change-kind">{change.kind}</span><code>{change.path}</code></summary>
      <div class="conflict-values">
        <div><strong>Before</strong><pre>{change.before ?? "Missing"}</pre></div>
        <div><strong>After</strong><pre>{change.after ?? "Missing"}</pre></div>
      </div>
    </details>
  {/each}
{/snippet}

<div class="schema-history">
  <button type="button" class="history-toggle" aria-expanded={open} aria-controls={`schema-history-${id}`} onclick={() => open = !open}>
    <MaterialIcon name="keyboard_arrow_right" size={18} />
    <span>Schema history</span>
    <MaterialIcon name="history" size={20} />
  </button>
  <Reveal {open} id={`schema-history-${id}`}>
    <div class="history-content" aria-busy={loading || acting}>
      {#if error}<p role="alert">{error}</p><Button size="sm" variant="secondary" disabled={acting} onclick={refresh}>Reload history</Button>{/if}
      {#if loading && !history}<p role="status">Loading schema history…</p>{/if}
      {#if history}
        {#if onBundledUpdate}<div class="conflict-actions"><Button size="sm" variant="secondary" disabled={acting || loading} onclick={applyBundled}>Apply bundled revision</Button></div>{/if}
        {#if history.incoming}
          <section class="merge-review" aria-label="Review schema conflicts">
            <p>The incoming schema overlaps local changes. Your current schema stays active until you resolve these fields.</p>
            {#each history.incoming.conflicts as conflict (conflict.path)}
              <fieldset>
                <legend>{conflict.path || "/"}</legend>
                <div class="conflict-values"><div><strong>Current</strong><pre>{preview(conflict.current)}</pre></div><div><strong>Incoming</strong><pre>{preview(conflict.incoming)}</pre></div></div>
                <div class="conflict-actions">
                  <Button size="sm" variant="secondary" aria-label={`Keep current: ${conflict.path}`} aria-pressed={choices[conflict.path] === "current"} disabled={acting}
                    onclick={() => choices[conflict.path] = "current"}>Keep current</Button>
                  <Button size="sm" variant="secondary" aria-label={`Use incoming: ${conflict.path}`} aria-pressed={choices[conflict.path] === "incoming"} disabled={acting}
                    onclick={() => choices[conflict.path] = "incoming"}>Use incoming</Button>
                </div>
              </fieldset>
            {/each}
            <div class="conflict-actions">
              {#if onDismiss}<Button size="sm" variant="secondary" disabled={acting} onclick={() => review(false)}>Discard update</Button>{/if}
              {#if onResolve}<Button size="sm" disabled={acting || !canResolve} onclick={() => review(true)}>Apply update</Button>{/if}
            </div>
          </section>
        {/if}
        <div class="branch-heads" aria-label="Schema branches">
          {#each history.branches as branch}<span><strong>{branch.name}</strong> <code>{branch.oid.slice(0, 7)}</code></span>{/each}
        </div>
        <div class="history-graph">
          <WorkflowHistory workflowId={id} {revisions} currentRevision={selected} comparisonRevision={diff?.base?.oid ?? null}
            busy={acting || loadingDiff} onselect={oid => select(oid)}
            label="Schema version history" versionsLabel="Saved schema versions" currentLabel="Selected revision" primaryBranch="Working" showBranches alternateColor="var(--color-muted-foreground)" />
        </div>
        {#if history.truncated && historyLimit < 1000}<Button size="sm" variant="secondary" disabled={loading} onclick={() => { historyLimit += 100; void refresh(); }}>Load more revisions</Button>{/if}
        <section class="revision-diff" aria-label="Schema changes" aria-busy={loadingDiff}
          data-revision={diff?.revision.oid} data-base={diff?.base?.oid}>
          <h4>Changes</h4>
          {#if loadingDiff && !diff}<p role="status">Loading changes…</p>{/if}
          {#if diff}
            <p class="diff-commit"><strong>{diff.revision.message}</strong><code>{diff.revision.oid.slice(0, 7)}</code></p>
            {#if !diff.base}
              <p>Initial schema import. This commit establishes the starting document.</p>
              <details class="import-fields"><summary>Imported schema sections ({diff.changes.length}{diff.truncated ? "+" : ""})</summary>{@render fields(diff.changes)}</details>
            {:else}
              <div class="comparison-parents" role="group" aria-label="Comparison parent">
                <p>Compare with{diff.parents.length > 1 ? " parent" : ""}</p>
                {#each diff.parents as parent, index (parent.oid)}
                  <button type="button" class="comparison-parent" aria-pressed={diff.base.oid === parent.oid} disabled={loadingDiff || acting}
                    data-parent-oid={parent.oid} onclick={() => select(selected, parent.oid)}>
                    {#if diff.parents.length > 1}<span>{index === 0 ? "First parent" : "Other parent"}</span>{/if}
                    <strong>{parent.message}</strong><code>{parent.oid.slice(0, 7)}</code>
                  </button>
                {/each}
                {#if !revisions.some(revision => revision.oid === diff!.base!.oid)}<p>The comparison parent is outside the loaded graph. Load more revisions to show its connection.</p>{/if}
              </div>
              {#if !diff.changes.length}<p>No content changes compared with this parent.{diff.parents.length > 1 ? " This merge still records the joined branch history." : ""}</p>{/if}
              {#each groups as group (group.label)}
                <details class="change-group">
                  <summary><strong>{group.label}</strong><span>{group.count}</span></summary>
                  {#if group.correction}<p>The same authentication correction is applied per operation. Added provenance fields retain the original rules.</p>{/if}
                  {@render fields(group.changes)}
                </details>
              {/each}
            {/if}
            {#if diff.truncated}
              {#if diffLimit < 1000}<Button size="sm" variant="secondary" disabled={loadingDiff} onclick={() => { diffLimit += 200; void select(selected, comparison); }}>Load more changes</Button>
              {:else}<p>Showing the first 1,000 changed fields.</p>{/if}
            {/if}
          {/if}
        </section>
      {/if}
    </div>
  </Reveal>
</div>

<style>
  .schema-history { min-width: 0; margin-top: 12px; border-radius: 4px; background: var(--color-background); color: var(--color-foreground); }
  .history-toggle { display: flex; align-items: center; width: 100%; gap: 8px; padding: 10px 12px; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left; font-size: 12px; font-weight: 700; }
  .history-toggle > span { flex: 1; }
  .history-toggle :global(.material-symbols-rounded:first-child) { transition: transform 180ms ease-in-out; }
  .history-toggle[aria-expanded="true"] :global(.material-symbols-rounded:first-child) { transform: rotate(90deg); }
  .history-toggle:focus-visible { outline: 2px solid var(--color-foreground); outline-offset: 2px; }
  .history-content { display: grid; gap: 12px; min-width: 0; padding: 12px; font-size: 12px; }
  .branch-heads, .conflict-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .branch-heads > span { padding: 4px 6px; border-radius: 3px; background: var(--color-surface); }
  .branch-heads code { font-size: 11px; color: var(--color-muted-foreground); }
  .diff-commit, .comparison-parent { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; overflow-wrap: anywhere; }
  .diff-commit code, .comparison-parent code { color: var(--color-muted-foreground); font-size: 11px; }
  .comparison-parents { display: grid; gap: 6px; min-width: 0; }
  .comparison-parent { padding: 8px; border: 0; border-left: 2px solid transparent; border-radius: 4px; background: var(--color-surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .comparison-parent[aria-pressed="true"] { border-left-color: var(--color-badge-background); }
  .comparison-parent > span { color: var(--color-muted-foreground); }
  .comparison-parent:focus-visible { outline: 2px solid var(--color-foreground); outline-offset: 2px; }
  .change-group, .import-fields { min-width: 0; padding: 4px; border-radius: 4px; background: var(--color-surface); }
  .change-group > summary { flex-wrap: wrap; }
  .change-group > summary > span { color: var(--color-muted-foreground); }
  .change-group > p { padding: 6px; color: var(--color-muted-foreground); }
  .history-graph { max-height: 400px; min-width: 0; padding: 6px; overflow: auto; }
  .history-graph :global(.version-card:hover) { transform: none; }
  .merge-review, .revision-diff { display: grid; gap: 10px; min-width: 0; }
  .merge-review { padding: 12px; border-left: 2px solid var(--color-badge-background); border-radius: 4px; background: var(--color-surface); }
  .conflict-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-width: 0; }
  .conflict-values > div { min-width: 0; }
  .conflict-actions { justify-content: flex-end; }
  fieldset { min-width: 0; padding: 8px; border: 1px solid var(--color-muted-foreground); border-radius: 4px; }
  legend, summary code { overflow-wrap: anywhere; word-break: break-word; }
  pre { max-height: 200px; margin: 6px 0; padding: 8px; border-radius: 3px; overflow: auto; background: var(--color-surface); color: var(--color-foreground); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .merge-review pre { background: var(--color-background); }
  h4, p { margin: 0; }
  h4 { font-size: 12px; }
  summary { display: flex; gap: 6px; align-items: baseline; cursor: pointer; padding: 6px; }
  .change-kind { flex-shrink: 0; font-size: 11px; color: var(--color-muted-foreground); }
  [role="alert"] { padding: 10px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); overflow-wrap: anywhere; }
  :global(.conflict-actions button[aria-pressed="true"]) { outline: 2px solid var(--color-foreground); outline-offset: -2px; }
  @container (max-width: 430px) { .conflict-values { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { .history-toggle :global(.material-symbols-rounded) { transition: none; } }
</style>
