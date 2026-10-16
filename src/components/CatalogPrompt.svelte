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

  let { value, pending, error, evaluation, matchingOpen, evaluationDetails = false, onChange, onMatchingToggle, onRetry }: {
    value: string;
    pending: boolean;
    error: string;
    evaluation: { prompt: string; candidates: OperationMatch[]; results: OperationMatch[]; durationMs: number } | null;
    matchingOpen: boolean;
    evaluationDetails?: boolean;
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
    <div class="prompt-entry">
      {#if evaluationDetails}
        <HintButton class="prompt-symbol" type="button" label="Details" aria-label="Review matching details"
          disabled={!evaluation} aria-expanded={matchingOpen && Boolean(evaluation)} aria-controls="matching-help"
          onclick={onMatchingToggle}><MaterialIcon name="manage_search" size={20} /></HintButton>
      {:else}
        <label class="prompt-symbol" for="operation-prompt" aria-hidden="true"><MaterialIcon name="search" size={20} /></label>
      {/if}
      <textarea id="operation-prompt" bind:this={input} value={value} use:fitTextarea={value} rows="1" maxlength="240"
        placeholder="Search" aria-label="Prompt" aria-describedby="prompt-help" oninput={(event) => onChange(event.currentTarget.value, event instanceof InputEvent && event.isComposing)}
        oncompositionstart={() => onChange(value, true)} oncompositionend={(event) => onChange(event.currentTarget.value, false)}></textarea>
    </div>
  </div>
  <p id="prompt-help" class="sr-only">Find operations by name or identifier. Matching operations appear automatically as you type. Clear the prompt to browse all operations.</p>
  <p class="matching-status" role="status" aria-live="polite">
    {#if pending}Finding operations…{:else if evaluation && !evaluation.results.length}No matching operations.{/if}
  </p>
  {#if error}
    <p class="matching-error" role="alert">{error}</p>
    <button type="button" class="text-button" onclick={onRetry}>Retry matching</button>
  {/if}
  {#if evaluationDetails}
  <Reveal open={matchingOpen && Boolean(evaluation)} id="matching-help">
    {#if evaluation}
      <EvaluationReport durationMs={evaluation.durationMs} candidates={evaluation.candidates}
        results={evaluation.results} considered={evaluation.candidates.length} />
    {/if}
  </Reveal>
  {/if}
</section>

<style>
  .catalog-prompt { min-width: 0; margin-bottom: 16px; }
  .prompt-input { --prompt-cap-radius: calc(var(--navigation-control-size) / 2); display: flex; flex-direction: column; border-radius: var(--prompt-cap-radius) 4px 4px var(--prompt-cap-radius); outline: 3px solid transparent; outline-offset: 3px; transition: outline-color 180ms ease-in; }
  .prompt-input:focus-within, .prompt-input:hover:has(textarea:enabled) { outline-color: var(--color-ring); }
  .prompt-entry { display: grid; grid-template-columns: var(--navigation-control-size) minmax(0, 1fr); }
  .prompt-entry :global(.prompt-symbol) { display: grid; place-items: center; min-height: var(--navigation-control-size); padding: 0; border: 0; border-radius: var(--prompt-cap-radius) 0 0 var(--prompt-cap-radius); background: var(--color-background); color: var(--color-foreground); transition: background-color 180ms ease-in, color 180ms ease-in; }
  label.prompt-symbol { cursor: text; }
  .prompt-entry :global(button.prompt-symbol) { outline: none; }
  #operation-prompt { --field-background: var(--color-background); --field-foreground: var(--color-foreground); display: block; box-sizing: border-box; width: 100%; min-width: 0; min-height: var(--navigation-control-size); field-sizing: fixed; padding: calc((var(--navigation-control-size) - 1.5em) / 2) 12px calc((var(--navigation-control-size) - 1.5em) / 2) 0; border: 0; border-radius: 0 4px 4px 0; background: var(--field-background); color: var(--field-foreground); font-size: 13px; line-height: 1.5; resize: none; overflow: hidden; scrollbar-gutter: auto; }
  #operation-prompt { outline: none; }
  #operation-prompt::placeholder { color: var(--color-muted-foreground); opacity: 1; }
  .matching-status { margin: 0; color: var(--color-muted-foreground); font-size: 12px; }
  .matching-status:not(:empty) { margin-top: 8px; }
  .matching-error { margin: 8px 0; color: var(--color-foreground); font-size: 12px; }
  .catalog-prompt :global(.detail-report) { margin: 12px 0 0; padding: 12px 0; }
  .catalog-prompt :global(.report-metrics) { grid-template-columns: minmax(0, 1fr); }
  .catalog-prompt :global(.report-metric) { min-height: 72px; padding: 10px; gap: 4px; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .prompt-entry :global(button.prompt-symbol:not(:disabled) .material-symbols-rounded) { transition: transform 180ms ease-in; }
    .prompt-entry :global(button.prompt-symbol:not(:disabled):hover .material-symbols-rounded) { transform: scale(1.4); }
  }
  @media (forced-colors: active) {
    .prompt-input:not(:focus-within):not(:hover) { outline-style: none; }
  }
</style>
