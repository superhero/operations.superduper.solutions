<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { SchemaFieldDiff } from "$lib/schema-diff.ts";
  import type { SchemaRevisionDiff } from "$lib/schema-storage.ts";

  let { change, load }: { change: SchemaRevisionDiff["changes"][number]; load: (limit: number) => Promise<SchemaFieldDiff> } = $props();
  let open = $state(false);
  let diff = $state<SchemaFieldDiff>();
  let loading = $state(false);
  let error = $state("");
  let limit = $state(200);
  let generation = 0;
  $effect(() => {
    if (open) untrack(() => { void refresh(); });
    else untrack(() => { generation++; diff = undefined; error = ""; limit = 200; loading = false; });
  });
  onDestroy(() => { generation++; });
  async function refresh() {
    const request = ++generation;
    loading = true; error = "";
    try { const next = await load(limit); if (request === generation) diff = next; }
    catch (failure) { if (request === generation) error = failure instanceof Error ? failure.message : "Could not read this field's changes."; }
    finally { if (request === generation) loading = false; }
  }
</script>

<details class="field-change" bind:open>
  <summary><span class="change-kind">{change.kind}</span><code title={change.path}>{change.path}</code></summary>
  {#if open}
    <div class="field-content" aria-busy={loading}>
      {#if error}<p role="alert">{error}</p><Button size="sm" variant="secondary" disabled={loading} onclick={refresh}>Retry changes</Button>{/if}
      {#if loading && !diff}<p role="status">Loading changes…</p>{/if}
      {#if diff}
        <div class="diff-values" class:single={!diff.before || !diff.after}>
          {#each ["before", "after"] as side}
            {#if side === "before" ? diff.before : diff.after}
              <div class="diff-side" data-side={side}>
                {#if diff.before && diff.after}<strong class="diff-heading">{side === "before" ? "Before" : "After"}</strong>{/if}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable diff panes need keyboard focus for horizontal scrolling.) -->
                <div class="diff-code" role="region" aria-label={`${side === "before" ? "Before" : "After"} ${change.path}`} tabindex="0">
                  <pre>{#each diff.rows as row}{@const line = side === "before" ? row.before : row.after}<span class="diff-line" class:added={line?.kind === "added"} class:removed={line?.kind === "removed"} class:gap={row.omitted !== undefined}><span class="line-number" aria-hidden="true">{line?.number ?? ""}</span><span class="line-sign" aria-hidden="true">{line?.kind === "added" ? "+" : line?.kind === "removed" ? "-" : " "}</span><code>{row.omitted !== undefined ? `… ${row.omitted} unchanged lines …` : line?.text || " "}</code></span>{/each}</pre>
                </div>
              </div>
            {/if}
          {/each}
        </div>
        {#if diff.coarse}<p class="hint">Large edit shown as a replacement to limit comparison work.</p>{/if}
        {#if diff.truncated}
          <p class="hint">Diff display limited to {limit.toLocaleString()} rows and 512 KiB of text. Complete values remain in the saved commits.</p>
          {#if limit < 5000 && !diff.textTruncated}<Button size="sm" variant="secondary" disabled={loading} onclick={() => { limit = Math.min(5000, limit + 400); void refresh(); }}>Show more lines</Button>{/if}
        {/if}
      {/if}
    </div>
  {/if}
</details>

<style>
  .field-change, .field-content, .diff-side { min-width: 0; }
  summary { display: flex; gap: 6px; align-items: baseline; min-width: 0; padding: 6px; cursor: pointer; }
  summary code { flex: 1; min-width: 0; overflow: clip; text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal; word-break: normal; user-select: text; }
  .change-kind { flex-shrink: 0; font-size: 11px; color: var(--color-muted-foreground); }
  .field-content { display: grid; gap: 8px; padding: 0 6px 6px; }
  .diff-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 8px; min-width: 0; }
  .diff-values.single { grid-template-columns: minmax(0, 1fr); }
  .diff-heading { display: block; margin-bottom: 6px; }
  .diff-code { max-height: 320px; min-width: 0; overflow: auto; border-radius: 3px; background: var(--color-background); }
  pre { width: max-content; min-width: 100%; margin: 0; padding: 6px 0; font: 11px/1.8 monospace; white-space: pre; overflow-wrap: normal; word-break: normal; user-select: text; }
  .diff-line { display: block; padding: 0 8px 0 0; }
  .line-number { display: inline-block; width: 4ch; margin-right: 1ch; color: var(--color-muted-foreground); text-align: right; user-select: none; }
  .line-sign { display: inline-block; width: 2ch; user-select: none; }
  .added { background: color-mix(in srgb, #2ea043 24%, var(--color-background)); }
  .removed { background: color-mix(in srgb, #f85149 24%, var(--color-background)); }
  .gap, .hint { color: var(--color-muted-foreground); }
  p { margin: 0; }
  [role="alert"] { padding: 8px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); overflow-wrap: anywhere; }
</style>
