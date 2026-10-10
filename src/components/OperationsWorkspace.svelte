<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, tick } from "svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import OperationFieldControl from "$lib/components/OperationFieldControl.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import Reveal from "$lib/components/Reveal.svelte";
  import JsonView from "$lib/components/JsonView.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { Operation, InputField } from "$lib/catalog.ts";
  import { evaluateOperations, type OperationMatch } from "$lib/matching.ts";
  import EvaluationReport from "./reports/EvaluationReport.svelte";
  import OperationReport from "./reports/OperationReport.svelte";
  import "./reports/reports.css";
  import { InputValidationError, prepareRequest } from "$lib/operation-input.ts";
  import { createWorkflowExecution, WorkflowResponseError, type WorkflowResponse } from "$lib/workflow-execution.ts";
  let { operations, active = true, onAddToWorkflow, onOperationSelect }: { operations: Operation[]; active?: boolean; onAddToWorkflow: (operation: Operation) => void; onOperationSelect?: (operation: Operation) => void } = $props();
  const steps = ["Prompt", "Evaluation", "Operation"];
  const locations = [{ key: "path", label: "Path" }, { key: "query", label: "Query" }, { key: "header", label: "Headers" }, { key: "body", label: "Request body" }] as const;
  let step = $state(0);
  // Input editing and execution results both belong to Operation.
  const navigationStep = $derived(Math.min(step, steps.length - 1));
  let progress = $state<HTMLElement>();
  let compactProgress = $state(false);
  let prompt = $state("");
  let promptError = $state(false);
  let searched = $state(false);
  let searchedPrompt = $state("");
  let results = $state<OperationMatch[]>([]);
  let evaluation = $state<{ candidates: OperationMatch[]; durationMs: number; considered: number } | null>(null);
  let selected = $state<Operation | null>(null);
  let drafts = $state<Record<string, Record<string, string>>>({});
  let prepared = $state<ReturnType<typeof prepareRequest> | null>(null);
  const executor = createWorkflowExecution();
  let requestController: AbortController | undefined;
  let executing = $state(false);
  let response = $state<WorkflowResponse | null>(null);
  let requestError = $state("");
  let error = $state("");
  let fieldError = $state<InputValidationError | null>(null);
  let matchingOpen = $state(false);
  let resultInfo = $state<string[]>([]);
  let operationDetails = $state(false);
  let operationDescription = $state(false);
  let fieldHelp = $state<string[]>([]);
  let panels = $state<HTMLElement[]>([]);
  let panelHeight = $state(0);
  let mounted = $state(false);
  let promptFooter = $state<HTMLElement>();
  let examples = $state<HTMLElement>();
  let suggestionLabel = $state<HTMLElement>();
  let promptInput: HTMLTextAreaElement;
  let promptForm: HTMLFormElement;
  let submitPrompt = $state<HTMLButtonElement | null>(null);
  let stepNavigation = 0;
  let stepScrollTarget: number | null = null;
  const values = $derived(selected ? drafts[selected.id]! : {});
  const available = $derived([true, searched, Boolean(selected)]);
  const complete = $derived([searched, searched && Boolean(selected && results.some(result => result.operation.id === selected!.id))]);
  const bodyProvided = $derived(Boolean(selected?.bodyRequired || selected?.fields.some(field => field.location === "body" && values[field.key]?.trim())));
  const toggle = (list: string[], key: string) => list.includes(key) ? list.filter(value => value !== key) : [...list, key];
  export async function focusActive() {
    await tick();
    const panel = panels[step];
    if (!panel || panel.closest('[hidden],[inert]')) return;
    // Open reports and descriptions precede the inputs; return to their title
    // instead of scrolling past them to the first field.
    const target = step === 0 ? panel.querySelector<HTMLElement>("textarea") : step === 2 && !operationDetails && !operationDescription ? (panel.querySelector<HTMLElement>("input,select,textarea,[role=combobox]") ?? panel.querySelector<HTMLElement>("h2")) : panel.querySelector<HTMLElement>("h2");
    target?.focus({ preventScroll: true });
    return target;
  }
  export function cancelStepScroll() {
    stepNavigation++;
    if (stepScrollTarget === null) return;
    stepScrollTarget = null;
    window.scrollTo({ top: window.scrollY, behavior: "instant" });
  }
  async function goTo(next: number) {
    if (next !== 3) cancelRequest();
    cancelStepScroll();
    const navigation = stepNavigation;
    step = next;
    const target = await focusActive();
    const panel = panels[next];
    if (!target || !panel || stepNavigation !== navigation) return;
    // Settle the new page height before scrolling; focus restoration between
    // workspaces still uses focusActive() without changing the reading position.
    panelHeight = panel.getBoundingClientRect().height;
    await tick();
    if (stepNavigation !== navigation) return;
    const bounds = target.getBoundingClientRect();
    const header = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
    const availableHeight = window.innerHeight - header - 24;
    const adjustment = bounds.top < header + 12 || bounds.height > availableHeight
      ? bounds.top - header - 12
      : Math.max(0, bounds.bottom - window.innerHeight + 12);
    if (adjustment) {
      const top = Math.max(0, Math.min(window.scrollY + adjustment, document.documentElement.scrollHeight - window.innerHeight));
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      stepScrollTarget = reducedMotion ? null : top;
      window.scrollTo({ top, behavior: reducedMotion ? "instant" : "smooth" });
    }
  }
  function search() {
    if (!prompt.trim()) {
      promptError = true;
      promptInput.focus({ preventScroll: true });
      return;
    }
    promptError = false;
    const started = performance.now();
    const comparison = evaluateOperations(prompt, operations);
    evaluation = { candidates: comparison.candidates, durationMs: performance.now() - started, considered: comparison.candidates.length };
    results = comparison.results; searchedPrompt = prompt; searched = true;
    resetExecution();
    selected = null; prepared = null; error = ""; fieldError = null;
    matchingOpen = false; resultInfo = []; operationDetails = false; operationDescription = false; fieldHelp = [];
    void goTo(1);
  }
  async function chooseExample(name: string) {
    prompt = name;
    promptError = false;
    await tick();
    promptInput.focus({ preventScroll: true });
  }
  export function selectOperation(operation: Operation) {
    resetExecution();
    if (selected?.id !== operation.id) { operationDetails = false; operationDescription = false; fieldHelp = []; }
    selected = operation; drafts[operation.id] ??= Object.fromEntries(operation.fields.map(field => [field.key, ""]));
    onOperationSelect?.(operation);
    prepared = null; error = ""; fieldError = null;
    void goTo(2);
  }
  function cancelRequest() {
    if (!requestController) return;
    requestController.abort();
    requestController = undefined;
    executing = false;
    requestError = "The request was cancelled.";
  }
  function resetExecution() {
    cancelRequest();
    response = null;
    requestError = "";
  }
  async function execute(event?: SubmitEvent) {
    event?.preventDefault(); if (!selected || executing) return;
    error = ""; fieldError = null;
    try { prepared = prepareRequest(selected, values); }
    catch (cause) {
      if (cause instanceof InputValidationError) { fieldError = cause; await tick(); document.getElementById(`field-${cause.fieldKey}`)?.focus(); }
      else error = cause instanceof Error ? cause.message : "Could not prepare the request.";
      return;
    }
    const operation = selected;
    const submittedValues = { ...values };
    const controller = new AbortController();
    requestController = controller;
    executing = true; response = null; requestError = "";
    void goTo(3);
    try {
      const result = await executor.execute(operation, submittedValues, controller.signal);
      if (requestController === controller) response = result.response;
    } catch (cause) {
      if (requestController !== controller) return;
      if (cause instanceof WorkflowResponseError) response = cause.response;
      requestError = cause instanceof Error ? cause.message : "The request could not be completed.";
    } finally {
      if (requestController === controller) { requestController = undefined; executing = false; }
    }
  }
  function edit(field: InputField, value: string) {
    resetExecution();
    values[field.key] = value; prepared = null; error = "";
    if (fieldError?.fieldKey === field.key) fieldError = null;
  }
  function describedBy(field: InputField) {
    return [field.description && fieldHelp.includes(field.key) ? `help-${field.key}` : "", fieldError?.fieldKey === field.key ? `error-${field.key}` : ""].filter(Boolean).join(" ") || undefined;
  }
  $effect(() => { if (!active) cancelRequest(); });
  $effect(() => {
    const panel = panels[step];
    if (!mounted || !panel) return;
    const resize = () => panelHeight = panel.getBoundingClientRect().height;
    const observer = new ResizeObserver(resize); observer.observe(panel); resize();
    return () => observer.disconnect();
  });
  onMount(() => {
    mounted = true;
    const fitProgress = () => {
      if (!progress?.clientWidth) return;
      compactProgress = [...progress.querySelectorAll<HTMLButtonElement>("button")].some(button => {
        const label = button.querySelector<HTMLElement>(".step-label");
        const style = getComputedStyle(button);
        return Boolean(label && label.offsetWidth > button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      });
    };
    const progressObserver = new ResizeObserver(fitProgress);
    if (progress) progressObserver.observe(progress);
    void document.fonts.ready.then(fitProgress);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const settleScroll = () => {
      if (!motion.matches || stepScrollTarget === null) return;
      const top = stepScrollTarget;
      stepScrollTarget = null;
      window.scrollTo({ top, behavior: "instant" });
    };
    const finishScroll = () => {
      if (stepScrollTarget !== null && Math.abs(window.scrollY - stepScrollTarget) < 1) stepScrollTarget = null;
    };
    const interruptScroll = (event: Event) => {
      if (stepScrollTarget === null) return;
      if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      cancelStepScroll();
    };
    motion.addEventListener("change", settleScroll);
    window.addEventListener("scrollend", finishScroll);
    window.addEventListener("wheel", interruptScroll, { passive: true });
    window.addEventListener("pointerdown", interruptScroll, { passive: true });
    window.addEventListener("keydown", interruptScroll);
    const fit = () => {
      if (!examples || !promptFooter || !submitPrompt) return;
      examples.hidden = false;
      const buttons = [...examples.querySelectorAll<HTMLButtonElement>("button")];
      const availableWidth = promptFooter.clientWidth - submitPrompt.getBoundingClientRect().width - parseFloat(getComputedStyle(promptFooter).columnGap);
      let used = 0; let count = 0; let overflow = false;
      for (const button of buttons) {
        button.hidden = false;
        const width = button.offsetWidth;
        const fits = !overflow && used + width <= availableWidth;
        if (fits) { used += width + 8; count++; }
        else { overflow = true; if (button === document.activeElement) promptInput.focus({ preventScroll: true }); button.hidden = true; }
      }
      if (suggestionLabel) suggestionLabel.hidden = count === 0;
      examples.hidden = count === 0;
    };
    const observer = new ResizeObserver(fit);
    if (promptFooter) observer.observe(promptFooter);
    if (submitPrompt) observer.observe(submitPrompt);
    void document.fonts.ready.then(fit);
    return () => {
      cancelRequest();
      progressObserver.disconnect();
      observer.disconnect();
      motion.removeEventListener("change", settleScroll);
      window.removeEventListener("scrollend", finishScroll);
      window.removeEventListener("wheel", interruptScroll);
      window.removeEventListener("pointerdown", interruptScroll);
      window.removeEventListener("keydown", interruptScroll);
      cancelStepScroll();
    };
  });
</script>

<section class="workspace" aria-label="Operations workspace">
  <nav class="workflow-progress" class:compact={compactProgress} bind:this={progress} aria-label="Progress"><ol class="workflow-step-list">
    {#each steps as name, index}<li><HintButton type="button" class={['workflow-step-button', complete[index] && index < navigationStep && 'is-complete']} label={available[index] ? name : index === 1 ? 'Search for operations to view the evaluation' : 'Select an operation to open its inputs'} aria-label={`${index + 1}. ${name}`}
      tooltipEnabled={compactProgress} aria-current={navigationStep === index ? "step" : undefined} disabled={!available[index]} onclick={() => goTo(index)}>
      <span class="button-content step-content"><MaterialIcon name={`counter_${index + 1}`} class="step-number" /><span class="step-label">{name}</span></span>
    </HintButton></li>{/each}
  </ol></nav>
  <div class="step-viewport" style:height={panelHeight ? `${panelHeight}px` : "auto"}>
    <div class="step-track" style:transform={`translateX(${-step * 100}%)`}>
      <section class="step-panel" bind:this={panels[0]} inert={step !== 0} aria-hidden={step !== 0} aria-label="Prompt step">
        <form bind:this={promptForm} onsubmit={(event) => { event.preventDefault(); search(); }}>
          <label for="operation-prompt" class="context-label prompt-label">Prompt</label>
          <textarea id="operation-prompt" bind:this={promptInput} bind:value={prompt} rows="4" maxlength="240" aria-required="true" placeholder="For example, list projects…" aria-invalid={promptError ? "true" : undefined} aria-describedby={promptError ? "prompt-help prompt-error" : "prompt-help"} oninput={() => promptError = false}
            onkeydown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
              event.preventDefault(); if (!event.repeat && submitPrompt && !submitPrompt.disabled) promptForm.requestSubmit(submitPrompt);
            }}></textarea>
          <Reveal open={promptError} id="prompt-error"><p class="error" role="alert">Enter a prompt to find a matching operation.</p></Reveal>
          <div class="form-footer prompt-footer" bind:this={promptFooter}>
            <div class="prompt-suggestions">
              <span class="context-label" bind:this={suggestionLabel}>Examples</span>
              <div class="prompt-suggestion-list" bind:this={examples}>
                {#each operations.slice(0, 3) as operation}<button type="button" onclick={() => chooseExample(operation.name)}><span class="button-content">{operation.name}</span></button>{/each}
              </div>
            </div>
            <HintButton bind:ref={submitPrompt} type="submit" class="primary-arrow" label="Find operations" tooltipSide="left" aria-label="Find operations"><MaterialIcon name="play_arrow" size={30} /></HintButton>
          </div>
          <p id="prompt-help" class="sr-only">Find an operation by name or identifier, even with a small typo. Enter searches; Shift+Enter adds a line break.</p>
        </form>
      </section>
      <section class="step-panel" bind:this={panels[1]} inert={step !== 1} aria-hidden={step !== 1} aria-label="Evaluation step">
        <div class="operation-toolbar report-pill context-label">
          <h2 class="operation-title" tabindex="-1">Evaluation: Listed operations</h2>
          <HintButton class="report-toggle" type="button" label="Details" aria-label="Review matching details" aria-expanded={matchingOpen} aria-controls="matching-help" onclick={() => matchingOpen = !matchingOpen}><MaterialIcon name="article" size={16} /></HintButton>
        </div>
        <Reveal open={matchingOpen} id="matching-help">
          {#if evaluation}<EvaluationReport prompt={searchedPrompt} durationMs={evaluation.durationMs} candidates={evaluation.candidates} considered={evaluation.considered} {results} />{/if}
        </Reveal>
        {#if results.length}<ol class="results-list">
          {#each results as result (result.operation.id)}<li class="result-card">
            <div class="result-row">
              <HintButton class="info-button" type="button" label="Description" aria-label={`About ${result.operation.name}`} aria-expanded={resultInfo.includes(result.operation.id)} aria-controls={`result-${result.operation.id}`} onclick={() => resultInfo = toggle(resultInfo, result.operation.id)}><MaterialIcon name="info" size={20} /></HintButton>
              <button class="result-name" type="button" aria-label={result.operation.name} onclick={() => selectOperation(result.operation)}>
                <span class="button-content">{result.operation.name}</span>
                <HintButton label={`${(result.similarity * 100).toFixed(2)}%`} labelAsName={false}>
                  {#snippet child({ props })}
                    {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
                    <span {...hintProps} class="result-similarity" aria-label={`Text similarity ${(result.similarity * 100).toFixed(2)} percent`}>{Math.round(result.similarity * 100)}%</span>
                  {/snippet}
                </HintButton>
              </button>
              <HintButton class="primary-arrow" type="button" label="Go to operation" aria-label={`Go to operation: ${result.operation.name}`} onclick={() => selectOperation(result.operation)}><MaterialIcon name="play_arrow" size={20} /></HintButton>
            </div>
            <Reveal open={resultInfo.includes(result.operation.id)} id={`result-${result.operation.id}`}><p class="result-description">{result.operation.description}</p></Reveal>
          </li>{/each}
        </ol>{:else}<div class="empty-state"><p>No matching operations.</p><p class="hint">Try an operation name from the catalog or one of the examples.</p><Button variant="secondary" tooltip="Edit your prompt and try another search" onclick={() => goTo(0)}>Edit prompt</Button></div>{/if}
      </section>
      <section class="step-panel" bind:this={panels[2]} inert={step !== 2} aria-hidden={step !== 2} aria-label="Operation step">
        {#if selected}
          <div class="operation-toolbar report-pill context-label">
            <h2 class="operation-title" tabindex="-1">Operation: {selected.name}</h2>
            <HintButton class="report-toggle" type="button" label="Details" aria-label="Review operation details" aria-expanded={operationDetails} aria-controls="operation-details" onclick={() => operationDetails = !operationDetails}><MaterialIcon name="article" size={16} /></HintButton>
            {#if selected.description}<HintButton class="report-toggle" type="button" label="Description" aria-label="Operation description" aria-expanded={operationDescription} aria-controls="operation-description" onclick={() => operationDescription = !operationDescription}><MaterialIcon name="info" size={16} /></HintButton>{/if}
          </div>
          {#if selected.description}<Reveal open={operationDescription} id="operation-description"><p class="hint field-description">{selected.description}</p></Reveal>{/if}
          <Reveal open={operationDetails} id="operation-details">{#key selected.id}<OperationReport operation={selected} />{/key}</Reveal>
          <form onsubmit={execute}>
            <div class="operation-fields">
              {#each locations as location}
                {@const fields = selected.fields.filter(field => field.location === location.key)}
                {#if fields.length}<fieldset class="request-input-group"><legend class="context-label">{location.label}</legend>
                  {#if location.key === "body" && !selected.bodyRequired}<p class="hint">Optional body. Starred fields are required when providing a body.</p>{/if}
                  {#each fields as field (field.key)}
                    <div class="operation-field"><div class="joined-field">
                      <label for={`field-${field.key}`}>{field.label}</label>
                      <OperationFieldControl {field} id={`field-${field.key}`} value={values[field.key] ?? ""} active={active && step === 2}
                        onValueChange={(value) => edit(field, value)} required={field.required && (field.location !== "body" || bodyProvided)}
                        multiline={field.location === "body" && selected.bodyMediaType === "text/plain"}
                        invalid={fieldError?.fieldKey === field.key} describedBy={describedBy(field)} />
                      {#if field.required || field.description}<div class="field-actions">
                        {#if field.required}<HintButton label="Required" labelAsName={false}>
                          {#snippet child({ props })}
                            {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
                            <span {...hintProps} class="required-marker" aria-hidden="true"><MaterialIcon name="asterisk" size={18} /></span>
                          {/snippet}
                        </HintButton>{/if}
                        {#if field.description}<HintButton type="button" class="info-button field-info" tabindex={-1} label="Description" aria-label={`About ${field.label}`} aria-expanded={fieldHelp.includes(field.key)} aria-controls={`help-${field.key}`} onclick={() => fieldHelp = toggle(fieldHelp, field.key)}><MaterialIcon name="info" size={18} /></HintButton>{/if}
                      </div>{/if}
                    </div>
                    {#if field.description}<Reveal open={fieldHelp.includes(field.key)} id={`help-${field.key}`}><p class="hint field-description">{field.description}</p></Reveal>{/if}
                    {#if fieldError?.fieldKey === field.key}<p role="alert" id={`error-${field.key}`} class="error">{fieldError.message}</p>{/if}
                    </div>
                  {/each}
                </fieldset>{/if}
              {/each}
              {#if !selected.fields.length}<p class="hint">This operation does not require any input.</p>{/if}
            </div>
            {#if error}<p role="alert" class="error">{error}</p>{/if}
            <div class="form-footer"><HintButton class="primary-arrow" type="submit" label="Execute operation" tooltipSide="left" aria-label="Execute operation" disabled={executing}><MaterialIcon name="play_arrow" size={30} /></HintButton></div>
          </form>
        {/if}
      </section>
      <section class="step-panel" bind:this={panels[3]} inert={step !== 3} aria-hidden={step !== 3} aria-label="Operation response">
        {#if selected && prepared}
          <div class="operation-heading"><div><p class="eyebrow">Operation response</p><h2 tabindex="-1">{selected.name}</h2></div></div>
          {#if executing}<p role="status">Request in progress…</p>{/if}
          {#if response}
            <p role="status">HTTP {response.status}</p>
            <section class="operation-response-body" aria-label="Response body">
              {#if response.body === null}<p class="hint">No response body.</p>
              {:else if typeof response.body === "string"}<pre>{response.body}</pre>
              {:else}<JsonView value={response.body} label="Response JSON" />{/if}
            </section>
          {/if}
          {#if requestError}<p role="alert" class="error">{requestError}</p>{/if}
          <div class="json-report" role="region" aria-label="Prepared request"><pre>{JSON.stringify(prepared, null, 2)}</pre></div>
          <div class="form-footer request-footer"><Button variant="secondary" tooltip="Return to the operation inputs" onclick={() => goTo(2)}>Edit inputs</Button>
            {#if executing}<Button tooltip="Cancel the pending request" onclick={cancelRequest}>Cancel request</Button>
            {:else if requestError}<Button tooltip="Send this request again" onclick={() => execute()}>Retry request</Button>{/if}
            <Button tooltip="Add this operation to your workflow" onclick={() => onAddToWorkflow(selected!)}><MaterialIcon name="workflow" size={18} /> Add to workflow</Button></div>
        {/if}
      </section>
    </div>
  </div>
</section>

<style>
  .workspace { margin: 8px 8px 0; padding-top: calc(var(--content-padding) - 8px); }
  .workflow-progress { margin-inline: calc(-1 * var(--content-padding) - 8px); }
  .operation-response-body { margin: 16px 0; }
  .operation-response-body pre { margin: 0; padding: 12px; background: var(--color-report-card); white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 ui-monospace, monospace; }
</style>
