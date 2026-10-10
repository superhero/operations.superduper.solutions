<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import type { Operation } from "$lib/catalog.ts";
  import { minimumSimilarity, topResultCount } from "$lib/matching.ts";

  type Candidate = { operation: Operation; similarity: number };
  let { prompt, durationMs, candidates, results, considered }:
    { prompt: string; durationMs: number; candidates: Candidate[]; results: Candidate[]; considered: number } = $props();

  const ranked = $derived([...candidates].sort((left, right) =>
    right.similarity - left.similarity || left.operation.id.localeCompare(right.operation.id)));
  const proposed = $derived(new Set(results.map(result => result.operation.id)));
  const proposedCandidates = $derived(ranked.filter(candidate => proposed.has(candidate.operation.id)));
  const notProposedCandidates = $derived(ranked.filter(candidate => !proposed.has(candidate.operation.id)));
  const otherCandidates = $derived(notProposedCandidates.slice(0, notProposedCandidates.length > proposedCandidates.length
    ? Math.max(0, proposedCandidates.length - 1) : proposedCandidates.length));
  const hiddenCandidates = $derived(notProposedCandidates.length - otherCandidates.length);
  const percentage = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });
  const precisePercentage = new Intl.NumberFormat("en", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const elapsed = $derived(durationMs < 0.01 ? "<0.01 ms" : durationMs < 1 ? `${durationMs.toFixed(2)} ms`
    : durationMs < 1000 ? `${durationMs.toFixed(1)} ms` : `${(durationMs / 1000).toFixed(2)} s`);

  function status(candidate: Candidate) {
    if (proposed.has(candidate.operation.id)) {
      return candidate.similarity > minimumSimilarity
        ? `Proposed: similarity exceeds ${percentage.format(minimumSimilarity)}`
        : `Proposed: among the top ${topResultCount} similarities`;
    }
    return `Not proposed: outside the top ${topResultCount} and similarity does not exceed ${percentage.format(minimumSimilarity)}`;
  }
</script>

{#snippet separator(label?: string)}
  <div class="evaluation-connection" aria-hidden={label ? undefined : true}>
    <span>{#if label}{label}{:else}<MaterialIcon name="stat_minus_2" size={20} />{/if}</span>
  </div>
{/snippet}

<section class="detail-report evaluation-report" aria-label="Evaluation report">
  <div class="report-metrics">
    <div class="report-metric"><span class="report-metric-value">{elapsed}</span><span class="report-metric-label">Evaluation time</span></div>
    <div class="report-metric">
      <HintButton label={precisePercentage.format(ranked[0]?.similarity ?? 0)} labelAsName={false}>
        {#snippet child({ props })}
          {@const { type: _type, ...hintProps } = props}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the tooltip for this read-only value.) -->
          <span {...hintProps} class="report-metric-value" tabindex="0" aria-label={`Top similarity ${precisePercentage.format(ranked[0]?.similarity ?? 0)}`}>{percentage.format(ranked[0]?.similarity ?? 0)}</span>
        {/snippet}
      </HintButton>
      <span class="report-metric-label">Top similarity</span>
    </div>
    <div class="report-metric"><span class="report-metric-value">{considered}</span><span class="report-metric-label">Considered operations</span></div>
  </div>

  {@render separator("Prompt")}
  <div class="evaluation-prompt"><p>{prompt}</p><MaterialIcon name="keyboard" size={20} /></div>

  {@render separator()}
  {#if proposedCandidates.length}
    <div class="evaluation-columns" class:single={notProposedCandidates.length === 0}>
      {#each [
        { label: "Proposed operations", items: proposedCandidates, selected: true },
        { label: "Not proposed operations", items: otherCandidates, selected: false }
      ] as group (group.label)}
        {#if group.items.length || (!group.selected && hiddenCandidates)}
          <ol class="evaluation-candidates" aria-label={group.label}>
            {#each group.items as candidate (candidate.operation.id)}
              <li class="evaluation-candidate" class:proposed={group.selected}>
                <span class="candidate-name">{candidate.operation.name}</span>
                <HintButton label={precisePercentage.format(candidate.similarity)} labelAsName={false}>
                  {#snippet child({ props })}
                    {@const { type: _type, ...hintProps } = props}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the tooltip for this read-only value.) -->
                    <span {...hintProps} class="candidate-score" tabindex="0" aria-label={`Text similarity ${precisePercentage.format(candidate.similarity)}`}>{percentage.format(candidate.similarity)}</span>
                  {/snippet}
                </HintButton>
                <HintButton label={status(candidate)} labelAsName={false}>
                  {#snippet child({ props })}
                    {@const { type: _type, ...hintProps } = props}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the tooltip for this read-only status.) -->
                    <span {...hintProps} class="candidate-status" role="img" tabindex="0" aria-label={status(candidate)}>
                      <MaterialIcon name={group.selected ? (candidate === proposedCandidates[0] && candidate.similarity > 0.75 ? "verified" : candidate.similarity < minimumSimilarity ? "check_small" : "check_circle") : "close_small"} size={20} />
                    </span>
                  {/snippet}
                </HintButton>
              </li>
            {/each}
            {#if !group.selected && hiddenCandidates}
              {@const explanation = `${hiddenCandidates} more ${hiddenCandidates === 1 ? "operation" : "operations"} considered but not shown here`}
              <li class="evaluation-candidate evaluation-more">
                <strong>{hiddenCandidates} hidden {hiddenCandidates === 1 ? "operation" : "operations"}</strong>
                <HintButton label={explanation} labelAsName={false}>
                  {#snippet child({ props })}
                    {@const { type: _type, ...hintProps } = props}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the tooltip for this read-only status.) -->
                    <span {...hintProps} class="hidden-candidates-hint" role="img" tabindex="0" aria-label={explanation}><MaterialIcon name="more_horiz" size={20} /></span>
                  {/snippet}
                </HintButton>
              </li>
            {/if}
          </ol>
        {/if}
      {/each}
    </div>
  {/if}
  {@render separator()}
  {#if !results.length}<p class="hint evaluation-outcome">No operations to propose.</p>{/if}
</section>

<style>
  .evaluation-report { min-width: 0; container-type: inline-size; }
  .evaluation-report :global(.report-metric-value) { color: var(--color-report-metric-value); font-family: Rationale, sans-serif; font-size: 44px; font-weight: 400; line-height: 1.2; }
  .evaluation-connection { display: flex; justify-content: center; padding: 24px 0 14px; color: var(--color-accent); font-size: 10px; font-weight: 600; }
  .evaluation-connection:has(~ .evaluation-connection) { padding-bottom: 24px; }
  .evaluation-connection:last-child { padding-bottom: 0; }
  .evaluation-connection > span { display: flex; align-items: center; gap: 12px; width: 50%; }
  .evaluation-connection > span::before, .evaluation-connection > span::after { content: ""; flex: 1; height: 1px; color: var(--color-border); background: repeating-linear-gradient(to right, currentColor 0 4px, transparent 4px 12px); }
  .evaluation-connection > span::before { background-image: repeating-linear-gradient(to left, currentColor 0 4px, transparent 4px 12px); }
  .evaluation-prompt { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px 14px; border-left: 2px solid var(--color-border); border-radius: 4px; background: var(--color-report-card); }
  .evaluation-prompt p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }
  .evaluation-prompt :global(.material-symbols-rounded) { color: var(--color-report-background); }
  .evaluation-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .evaluation-columns.single { grid-template-columns: minmax(0, 1fr); }
  .evaluation-candidates { min-width: 0; margin: 0; padding: 0; list-style: none; }
  .evaluation-candidate { display: grid; grid-template-columns: minmax(0, 1fr) max-content 20px; align-items: center; gap: 8px; min-height: 40px; padding: 8px 10px; border-left: 2px solid var(--color-border); border-radius: 4px; background: var(--color-report-card); color: var(--color-foreground); font-size: 11px; }
  .evaluation-candidate + .evaluation-candidate { margin-top: 6px; }
  .evaluation-candidate.proposed { border-left-color: var(--color-badge-background); }
  .evaluation-candidate.evaluation-more { grid-template-columns: minmax(0, 1fr) 20px; color: var(--color-report-background); }
  .candidate-name { min-width: 0; overflow-wrap: anywhere; }
  .candidate-score { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .candidate-status, .hidden-candidates-hint { display: flex; color: var(--color-report-background); }
  .proposed .candidate-status { color: var(--color-badge-background); }
  .evaluation-outcome { color: var(--color-report-muted); text-align: center; }
  @container (max-width: 599px) {
    .evaluation-columns { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 599px) {
    .evaluation-report :global(.report-metrics) { grid-template-columns: minmax(0, 1fr); }
    .evaluation-candidate { gap: 6px; padding: 8px; }
  }
</style>
