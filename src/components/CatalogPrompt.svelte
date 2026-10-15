<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import Reveal from "$lib/components/Reveal.svelte";
  import type { OperationMatch } from "$lib/matching.ts";
  import EvaluationReport from "./reports/EvaluationReport.svelte";
  import "./reports/reports.css";

  let { value, pending, error, evaluation, matchingOpen, onChange, onMatchingToggle, onRetry }: {
    value: string;
    pending: boolean;
    error: string;
    evaluation: { prompt: string; candidates: OperationMatch[]; results: OperationMatch[]; durationMs: number } | null;
    matchingOpen: boolean;
    onChange: (value: string, composing?: boolean) => void;
    onMatchingToggle: () => void;
    onRetry: () => void;
  } = $props();
  let input: HTMLTextAreaElement;

  export function focus() {
    if (!input?.isConnected || input.closest("[hidden],[inert]")) return;
    input.focus({ preventScroll: true });
    return input;
  }

  function fitTextarea(node: HTMLTextAreaElement, _value: string) {
    let frame = 0;
    let disposed = false;
    let width = -1;
    const fit = () => {
      frame = 0;
      if (!node.clientWidth) return;
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      schedule();
    });
    observer.observe(node);
    void document.fonts.ready.then(schedule);
    fit();
    return { update: schedule, destroy: () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); } };
  }
</script>

<section class="catalog-prompt" aria-label="Find operations" aria-busy={pending} data-evaluated-prompt={evaluation?.prompt ?? ""}>
  <div class="prompt-input">
    <textarea id="operation-prompt" bind:this={input} value={value} use:fitTextarea={value} rows="1" maxlength="240"
      placeholder="Prompt" aria-label="Prompt" aria-describedby="prompt-help" oninput={(event) => onChange(event.currentTarget.value, event instanceof InputEvent && event.isComposing)}
      oncompositionstart={() => onChange(value, true)} oncompositionend={(event) => onChange(event.currentTarget.value, false)}></textarea>
    {#if evaluation}
      <div class="prompt-actions report-pill context-label">
        <HintButton class="report-toggle" type="button" label="Details" aria-label="Review matching details" aria-expanded={matchingOpen}
          aria-controls="matching-help" onclick={onMatchingToggle}><MaterialIcon name="article" size={16} /></HintButton>
      </div>
    {/if}
  </div>
  <p id="prompt-help" class="sr-only">Find operations by name or identifier. Matching operations appear automatically as you type. Clear the prompt to browse all operations.</p>
  <p class="matching-status" role="status" aria-live="polite">
    {#if pending}Finding operations…{:else if evaluation && !evaluation.results.length}No matching operations.{/if}
  </p>
  {#if error}
    <p class="matching-error" role="alert">{error}</p>
    <button type="button" class="text-button" onclick={onRetry}>Retry matching</button>
  {/if}
  <Reveal open={matchingOpen && Boolean(evaluation)} id="matching-help">
    {#if evaluation}
      <EvaluationReport prompt={evaluation.prompt} durationMs={evaluation.durationMs} candidates={evaluation.candidates}
        results={evaluation.results} considered={evaluation.candidates.length} />
    {/if}
  </Reveal>
</section>

<style>
  .catalog-prompt { min-width: 0; margin-bottom: 16px; }
  .prompt-input { display: flex; align-items: flex-start; gap: 12px; }
  .prompt-actions { flex-shrink: 0; margin-top: 6px; }
  .prompt-actions :global(.report-toggle) { height: 32px; padding: 4px; border-radius: 4px; }
  #operation-prompt { --field-background: var(--color-foreground); --field-foreground: var(--color-background); display: block; flex: 1; box-sizing: border-box; width: 100%; min-width: 0; min-height: var(--navigation-control-size); field-sizing: fixed; padding: calc((var(--navigation-control-size) - 1.5em) / 2) 12px; border: 0; border-radius: 4px; background: var(--field-background); color: var(--field-foreground); font-size: 13px; line-height: 1.5; resize: none; overflow: hidden; scrollbar-gutter: auto; }
  #operation-prompt:focus { outline: 3px solid var(--color-ring); outline-offset: 3px; }
  #operation-prompt::placeholder { color: var(--color-surface); opacity: 1; }
  .matching-status { margin: 0; color: var(--color-muted-foreground); font-size: 12px; }
  .matching-status:not(:empty) { margin-top: 8px; }
  .matching-error { margin: 8px 0; color: var(--color-foreground); font-size: 12px; }
  .catalog-prompt :global(.detail-report) { margin: 12px 0 0; padding: 12px; }
  .catalog-prompt :global(.report-metrics) { grid-template-columns: minmax(0, 1fr); }
  .catalog-prompt :global(.report-metric) { min-height: 72px; padding: 10px; gap: 4px; }
</style>
