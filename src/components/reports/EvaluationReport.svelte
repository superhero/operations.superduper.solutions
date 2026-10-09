<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { Operation } from "$lib/catalog.ts";
  import { minimumSimilarity, resultLimit } from "$lib/matching.ts";

  type Candidate = { operation: Operation; similarity: number };
  let { prompt, durationMs, candidates, results, considered }:
    { prompt: string; durationMs: number; candidates: Candidate[]; results: Candidate[]; considered: number } = $props();

  const ranked = $derived([...candidates].sort((left, right) =>
    right.similarity - left.similarity || left.operation.id.localeCompare(right.operation.id)));
  const proposed = $derived(new Set(results.map(result => result.operation.id)));
  const proposedCandidates = $derived(ranked.filter(candidate => proposed.has(candidate.operation.id)));
  const otherCandidates = $derived(ranked.filter(candidate => !proposed.has(candidate.operation.id)).slice(0, proposedCandidates.length));
  const percentage = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });
  const precisePercentage = new Intl.NumberFormat("en", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const elapsed = $derived(durationMs < 0.01 ? "<0.01 ms" : durationMs < 1 ? `${durationMs.toFixed(2)} ms`
    : durationMs < 1000 ? `${durationMs.toFixed(1)} ms` : `${(durationMs / 1000).toFixed(2)} s`);

  function status(candidate: Candidate) {
    if (proposed.has(candidate.operation.id)) return "Proposed";
    return candidate.similarity > minimumSimilarity
      ? `Not proposed: outside the top ${resultLimit} results`
      : `Not proposed: similarity must exceed ${percentage.format(minimumSimilarity)}`;
  }
</script>

{#snippet separator(label: string, first = false, last = false)}
  <div class="evaluation-connection">
    {#if !first}<MaterialIcon name="keyboard_double_arrow_down" size={20} />{/if}
    <span>{label}</span>
    {#if !last}<MaterialIcon name="keyboard_double_arrow_down" size={20} />{/if}
  </div>
{/snippet}

<section class="detail-report evaluation-report" aria-label="Evaluation report">
  <div class="report-metrics">
    <div class="report-metric"><span class="report-metric-value">{elapsed}</span><span class="report-metric-label">Matching time</span></div>
    <div class="report-metric"><span class="report-metric-value" title={precisePercentage.format(ranked[0]?.similarity ?? 0)}>{percentage.format(ranked[0]?.similarity ?? 0)}</span><span class="report-metric-label">Top text similarity</span></div>
    <div class="report-metric"><span class="report-metric-value">{considered}</span><span class="report-metric-label">Considered operations</span></div>
  </div>

  {@render separator("Prompt", true)}
  <div class="evaluation-prompt"><p>{prompt}</p><MaterialIcon name="keyboard" size={20} /></div>

  {@render separator("Evaluate")}
  {#if proposedCandidates.length}
    <div class="evaluation-columns" class:single={otherCandidates.length === 0}>
      {#each [
        { label: "Proposed operations", items: proposedCandidates, selected: true },
        { label: "Not proposed operations", items: otherCandidates, selected: false }
      ] as group (group.label)}
        {#if group.items.length}
          <ol class="evaluation-candidates" aria-label={group.label}>
            {#each group.items as candidate (candidate.operation.id)}
              <li class="evaluation-candidate" class:proposed={group.selected}>
                <span class="candidate-name">{candidate.operation.name}</span>
                <span class="candidate-score" aria-label={`Text similarity ${precisePercentage.format(candidate.similarity)}`} title={precisePercentage.format(candidate.similarity)}>{percentage.format(candidate.similarity)}</span>
                <span class="candidate-status" role="img" aria-label={status(candidate)} title={status(candidate)}>
                  <MaterialIcon name={group.selected ? "check_circle" : "cancel"} size={20} />
                </span>
              </li>
            {/each}
          </ol>
        {/if}
      {/each}
    </div>
  {/if}
  <p class="hint evaluation-policy">Levenshtein compares the spelling of your prompt with operation names and identifiers.
    Each operation keeps its best text match. Scores are independent and do not measure confidence or probability.
    Up to {resultLimit} operations with similarity strictly above {percentage.format(minimumSimilarity)} are proposed, highest first.</p>

  {@render separator("Propose", false, true)}
  <p class="hint evaluation-outcome">{#if results.length}{results.length} {results.length === 1 ? "operation is" : "operations are"} proposed in the results below.{:else}No operations meet the matching threshold. Try an operation name or identifier.{/if}</p>
</section>

<style>
  .evaluation-report { min-width: 0; container-type: inline-size; }
  .evaluation-report :global(.report-metric-value) { color: var(--color-report-metric-value); font-family: Rationale, sans-serif; font-size: 44px; font-weight: 400; line-height: 1.2; }
  .evaluation-connection { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 0; color: var(--color-accent); font-size: 10px; font-weight: 600; }
  .evaluation-connection > span { display: flex; align-items: center; gap: 12px; width: 100%; }
  .evaluation-connection > span::before, .evaluation-connection > span::after { content: ""; flex: 1; height: 1px; color: var(--color-border); background: repeating-linear-gradient(to right, currentColor 0 4px, transparent 4px 12px); }
  .evaluation-connection > span::before { background-image: repeating-linear-gradient(to left, currentColor 0 4px, transparent 4px 12px); }
  .evaluation-prompt { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px 14px; border-left: 2px solid var(--color-border); border-radius: 4px; background: var(--color-report-card); }
  .evaluation-prompt p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }
  .evaluation-prompt :global(.material-symbols-rounded) { color: var(--color-report-background); }
  .evaluation-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .evaluation-columns.single { grid-template-columns: minmax(0, 1fr); }
  .evaluation-candidates { min-width: 0; margin: 0; padding: 0; list-style: none; }
  .evaluation-candidate { display: grid; grid-template-columns: minmax(0, 1fr) max-content 20px; align-items: center; gap: 8px; min-height: 40px; padding: 8px 10px; border-left: 2px solid var(--color-border); border-radius: 4px; background: var(--color-report-card); color: var(--color-report-muted); font-size: 11px; }
  .evaluation-candidate + .evaluation-candidate { margin-top: 6px; }
  .evaluation-candidate.proposed { border-left-color: var(--color-badge-background); color: var(--color-foreground); }
  .candidate-name { min-width: 0; overflow-wrap: anywhere; }
  .candidate-score { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .candidate-status { display: flex; color: var(--color-report-background); }
  .proposed .candidate-status { color: var(--color-badge-background); }
  .evaluation-policy { margin-top: 12px; color: var(--color-report-muted); font-size: 11px; overflow-wrap: anywhere; }
  .evaluation-outcome { color: var(--color-report-muted); text-align: center; }
  @container (max-width: 599px) {
    .evaluation-columns { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 599px) {
    .evaluation-report :global(.report-metrics) { grid-template-columns: minmax(0, 1fr); }
    .evaluation-candidate { gap: 6px; padding: 8px; }
  }
</style>
