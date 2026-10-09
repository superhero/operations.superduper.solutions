<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, tick } from "svelte";
  import OperationFieldControl from "$lib/components/OperationFieldControl.svelte";
  import JsonView from "$lib/components/JsonView.svelte";
  import { InputValidationError, prepareRequest } from "$lib/operation-input.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import { createWorkflowRunner, type WorkflowStep, type WorkflowExecution } from "$lib/workflow-runner.ts";
  import { workflowExecutionForOperation, workflowRequestUrl } from "$lib/workflow-execution.ts";

  let { document, onClose, startingNodeId }: { document: WorkflowDocument; onClose: () => void; startingNodeId?: string } = $props();
  let runner: ReturnType<typeof createWorkflowRunner> | undefined;
  let view = $state<WorkflowStep>();
  let values = $state<Record<string, string>>({});
  let selected = $state("");
  let error = $state("");
  let fieldError = $state("");
  let executed = $state(false);
  let fatal = $state(false);
  let busy = $state(false);
  let retry = $state(false);
  let disposed = false;
  let history = $state<WorkflowExecution[]>([]);
  let heading = $state<HTMLHeadingElement>();
  const destination = $derived(view?.kind === "operation" ? workflowExecutionForOperation(view.operation) : undefined);
  const requestUrl = $derived.by(() => {
    if (view?.kind !== "operation" || !destination) return "";
    try { return workflowRequestUrl(prepareRequest(view.operation, values), destination.origin); }
    catch { return `${destination.origin}${view.operation.path}`; }
  });

  function advance()
  {
    error = "";
    fieldError = "";
    executed = false;
    retry = false;
    try
    {
      view = runner!.next();
      values = view.kind === "operation" ? { ...view.values } : {};
      selected = view.kind === "choice" ? view.choices[0]?.id ?? "" : "";
      void tick().then(() => heading?.focus());
    }
    catch (cause) { error = cause instanceof Error ? cause.message : "The workflow could not continue."; fatal = true; }
  }

  function start()
  {
    try { runner!.choose(selected); advance(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Choose a starting operation."; }
  }

  async function execute(event: SubmitEvent)
  {
    event.preventDefault();
    if (executed || fatal || busy) return;
    error = "";
    fieldError = "";
    busy = true;
    try
    {
      const result = await runner!.submit(values);
      if (!disposed) { history = [...history, result]; executed = true; retry = false; }
    }
    catch (cause)
    {
      if (disposed) return;
      error = cause instanceof Error ? cause.message : "The operation could not run.";
      retry = !(cause instanceof InputValidationError);
      if (cause instanceof InputValidationError)
      {
        fieldError = cause.fieldKey;
        busy = false;
        await tick();
        globalThis.document.getElementById(`run-${cause.fieldKey}`)?.focus();
      }
    }
    finally { busy = false; }
  }

  function edit(key: string, value: string) { values[key] = value; error = ""; fieldError = ""; }
  function end() { runner?.end(); onClose(); }

  onMount(() => {
    try { runner = createWorkflowRunner(document, startingNodeId); advance(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "This workflow cannot be started."; fatal = true; }
    return () => { disposed = true; runner?.end(); };
  });
</script>

<div class="workflow-run">
  {#if destination}
    <p class="run-endpoint">{destination.kind === "mock" ? `Mock example: ${destination.origin}. Responses are simulated in this browser; no request is sent.` : `Live example: ${destination.origin}. Each confirmed step sends a request to this service.`}</p>
  {/if}
  {#if view?.kind === "choice" && !fatal}
    <section aria-label="Starting operation">
      <h3 bind:this={heading} tabindex="-1">Choose a starting operation</h3>
      <p class="hint">{view.workflowName} has several starting points. Choose the branch to run.</p>
      <div class="run-choices">
        {#each view.choices as choice (choice.id)}
          <label><input type="radio" name="workflow-start" value={choice.id} bind:group={selected} />{choice.label}</label>
        {/each}
      </div>
      <button class="run-primary" type="button" onclick={start} disabled={!selected}>Continue</button>
    </section>
  {:else if view?.kind === "operation" && !fatal}
    <section aria-label="Current workflow operation">
      <h3 bind:this={heading} tabindex="-1">{view.step}. {view.operation.name}</h3>
      <p class="hint">{view.workflowName} · {view.operation.description}</p>
      <p class="run-request"><strong>{view.operation.method}</strong> <code>{requestUrl}</code></p>
      <form onsubmit={execute} novalidate>
        <div class="run-fields">
          {#each view.operation.fields as field (field.key)}
            {@const connected = view.mappedFields.includes(field.key)}
            {@const disabled = busy || executed || connected}
            <div class="run-field">
              <label for={`run-${field.key}`}>{field.label}{#if field.required}<span aria-hidden="true"> *</span>{/if}</label>
              <div class="joined-field">
                <OperationFieldControl {field} id={`run-${field.key}`} value={values[field.key] ?? ""} {disabled}
                  portalZIndex={90} multiline={field.location === "body" && view.operation.bodyMediaType === "text/plain"}
                  invalid={fieldError === field.key} describedBy={fieldError === field.key ? "workflow-run-error" : undefined}
                  onValueChange={(value) => edit(field.key, value)} />
              </div>
              {#if connected}<small>Connected from workflow</small>{:else if field.description}<small>{field.description}</small>{/if}
            </div>
          {/each}
        </div>
        {#if executed}
          <p class="run-success" role="status">Operation completed.</p>
          <button class="run-primary" type="button" onclick={advance}>Next operation</button>
        {:else}
          <button class="run-primary" type="submit" disabled={busy}>{busy ? "Sending request…" : retry ? "Retry operation" : history.length ? "Run operation" : "Start workflow"}</button>
        {/if}
      </form>
    </section>
  {:else if view?.kind === "complete"}
    <h3 bind:this={heading} tabindex="-1">{view.message}</h3>
    <p role="status">{history.length} operation{history.length === 1 ? "" : "s"} completed.</p>
  {/if}
  {#if error}<p id="workflow-run-error" class="run-error" role="alert">{error}</p>{/if}
  {#if history.length}
    <section class="run-results" aria-label="Workflow results">
      <h3>Operation results</h3>
      {#each [...history].reverse() as result (result.step)}
        <details open={result.step === history.at(-1)?.step}>
          <summary>{result.step}. {result.operation.name} · {result.response.status}</summary>
          <JsonView value={result.response.body} label={`Step ${result.step} response`} />
        </details>
      {/each}
    </section>
  {/if}
  <footer><button type="button" onclick={end}>{view?.kind === "complete" ? "Close run" : "End run"}</button></footer>
</div>

<style>
  .workflow-run { display: grid; gap: 20px; min-width: 0; }
  .run-endpoint { margin: 0; padding: 12px; border-left: 3px solid var(--color-emphasis); background: var(--color-report-card); font-size: 12px; line-height: 1.6; }
  .run-request { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  h3:focus { outline: none; }
  .run-choices { display: grid; gap: 8px; margin: 12px 0; }
  .run-choices label { display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--color-report-card); }
  .run-fields { display: grid; gap: 16px; margin: 16px 0; }
  .run-field { display: grid; gap: 6px; }
  .run-field > label { font-size: 12px; font-weight: 700; }
  .run-field small { font-size: 11px; line-height: 1.5; color: var(--color-muted-foreground); }
  .joined-field { display: block; overflow: hidden; border-radius: 4px; --field-background: var(--color-foreground); --field-foreground: var(--color-background); }
  button { border: 1px solid var(--color-surface); border-radius: 4px; padding: 9px 14px; color: var(--color-foreground); background: transparent; }
  button.run-primary { background: var(--color-foreground); color: var(--color-background); }
  .run-success { font-size: 12px; }
  .run-error { margin: 0; padding: 12px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; line-height: 1.6; }
  .run-results { min-width: 0; display: grid; gap: 12px; }
  summary { cursor: pointer; padding: 10px 0; font-size: 12px; font-weight: 700; }
  footer { display: flex; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--color-surface); }
</style>
