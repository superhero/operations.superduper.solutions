<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, tick } from "svelte";
  import OperationFields from "$lib/components/OperationFields.svelte";
  import CredentialBindingSelector from "$lib/components/CredentialBindingSelector.svelte";
  import type { CredentialBinding } from "$lib/secrets/types.ts";
  import JsonView from "$lib/components/JsonView.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import Reveal from "$lib/components/Reveal.svelte";
  import OperationReport from "../reports/OperationReport.svelte";
  import "../reports/reports.css";
  import type { InputField } from "$lib/catalog.ts";
  import { InputValidationError, prepareRequest } from "$lib/operation-input.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import { createWorkflowRunner, type WorkflowStep, type WorkflowExecution } from "$lib/workflow-runner.ts";
  import { WorkflowResponseError, workflowExecutionForOperation, workflowRequestUrl, type WorkflowResponse } from "$lib/workflow-execution.ts";

  let { document, onClose, startingNodeId, onBindingChange = () => {} }: { document: WorkflowDocument; onClose: () => void;
    startingNodeId?: string; onBindingChange?: (path: string[], binding: CredentialBinding) => void } = $props();
  const operationFormId = $props.id();
  let runner: ReturnType<typeof createWorkflowRunner> | undefined;
  let view = $state<WorkflowStep>();
  let values = $state<Record<string, string>>({});
  let credentialBinding = $state<CredentialBinding>();
  let selected = $state("");
  let error = $state("");
  let fieldError = $state<InputValidationError | null>(null);
  let prepared = $state<ReturnType<typeof prepareRequest> | null>(null);
  let failedResponse = $state<WorkflowResponse | null>(null);
  let operationDetails = $state(false);
  let operationDescription = $state(false);
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
    fieldError = null;
    prepared = null;
    failedResponse = null;
    operationDetails = false;
    operationDescription = false;
    executed = false;
    retry = false;
    try
    {
      view = runner!.next();
      credentialBinding = view.kind === "operation" ? view.credentialBinding : undefined;
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
    if (view?.kind !== "operation" || executed || fatal || busy) return;
    error = "";
    fieldError = null;
    prepared = null;
    failedResponse = null;
    busy = true;
    try
    {
      const submittedValues = { ...values };
      prepared = prepareRequest(view.operation, submittedValues);
      const result = await runner!.submit(submittedValues, credentialBinding ?? null);
      if (!disposed) { prepared = result.request; history = [...history, result]; executed = true; retry = false; }
    }
    catch (cause)
    {
      if (disposed) return;
      error = cause instanceof Error ? cause.message : "The operation could not run.";
      retry = !(cause instanceof InputValidationError);
      if (cause instanceof WorkflowResponseError) failedResponse = cause.response;
      if (cause instanceof InputValidationError)
      {
        fieldError = cause;
        busy = false;
        await tick();
        globalThis.document.getElementById(`run-${cause.fieldKey}`)?.focus();
      }
    }
    finally { busy = false; }
  }

  function edit(field: InputField, value: string) {
    values[field.key] = value; error = ""; prepared = null; failedResponse = null;
    if (fieldError?.fieldKey === field.key) fieldError = null;
  }
  function end() { runner?.end(); onClose(); }

  onMount(() => {
    try { runner = createWorkflowRunner(document, startingNodeId); advance(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "This workflow cannot be started."; fatal = true; }
    return () => { disposed = true; runner?.end(); };
  });
</script>

{#snippet responseDetails(response: WorkflowResponse, label: string)}
  <section class="run-response" aria-label={label}>
    <p class="run-status">HTTP {response.status}{response.statusText ? ` ${response.statusText}` : ""}</p>
    <section class="run-response-body" aria-label="Response body">
      {#if response.body === null}<p class="hint">No response body.</p>
      {:else if typeof response.body === "string"}<pre>{response.body}</pre>
      {:else}<JsonView value={response.body} label={`${label} JSON`} />{/if}
    </section>
  </section>
{/snippet}

<div class="workflow-run">
  {#if destination}
    <p class="run-endpoint">Server: {destination.origin}. Each confirmed step sends a request to this service.</p>
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
    </section>
  {:else if view?.kind === "operation" && !fatal}
    <section aria-label="Current workflow operation">
      <div class="operation-toolbar report-pill context-label">
        <h3 class="operation-title" bind:this={heading} tabindex="-1">{view.step}. {view.operation.name}</h3>
        <HintButton class="report-toggle" type="button" label="Details" aria-label="Review operation details"
          aria-expanded={operationDetails} aria-controls="run-operation-details" onclick={() => operationDetails = !operationDetails}>
          <MaterialIcon name="article" size={16} />
        </HintButton>
        {#if view.operation.description}
          <HintButton class="report-toggle" type="button" label="Description" aria-label="Operation description"
            aria-expanded={operationDescription} aria-controls="run-operation-description" onclick={() => operationDescription = !operationDescription}>
            <MaterialIcon name="info" size={16} />
          </HintButton>
        {/if}
      </div>
      {#if view.operation.description}
        <Reveal open={operationDescription} id="run-operation-description"><p class="hint field-description">{view.operation.description}</p></Reveal>
      {/if}
      <Reveal open={operationDetails} id="run-operation-details">{#key view.id}<OperationReport operation={view.operation} />{/key}</Reveal>
      <p class="hint">{view.workflowName}</p>
      <p class="run-request"><strong>{view.operation.method}</strong> <code>{requestUrl}</code></p>
      <form id={operationFormId} onsubmit={execute} novalidate>
        {#if view.operation.security?.length}
          {#key view.id}
            <CredentialBindingSelector operation={view.operation} initial={view.credentialBinding} disabled={busy || executed} portalZIndex={90}
              onChange={binding => {
                credentialBinding = binding;
                if (binding && view?.kind === "operation") onBindingChange(view.bindingPath, binding);
              }} />
          {/key}
        {/if}
        {#key view.id}<OperationFields operation={view.operation} {values} {fieldError} idPrefix="run" portalZIndex={90}
          disabled={busy || executed} mappedFields={view.mappedFields} onValueChange={edit} />{/key}
        {#if executed}
          <p class="run-success" role="status">Operation completed.</p>
          <button class="run-primary" type="button" onclick={advance}>Next operation</button>
        {/if}
      </form>
    </section>
  {:else if view?.kind === "complete"}
    <h3 bind:this={heading} tabindex="-1">{view.message}</h3>
    <p role="status">{history.length} operation{history.length === 1 ? "" : "s"} completed.</p>
  {/if}
  {#if error && (!fieldError || view?.kind !== "operation" || !view.operation.fields.some(field => field.key === fieldError?.fieldKey))}
    <p id="workflow-run-error" class="run-error" role="alert">{error}</p>
  {/if}
  {#if failedResponse}{@render responseDetails(failedResponse, "Operation response")}{/if}
  {#if prepared && !executed}<div class="json-report" role="region" aria-label="Prepared request"><pre>{JSON.stringify(prepared, null, 2)}</pre></div>{/if}
  {#if history.length}
    <section class="run-results" aria-label="Workflow results">
      <h3>Operation results</h3>
      {#each [...history].reverse() as result (result.step)}
        <details open={result.step === history.at(-1)?.step}>
          <summary>{result.step}. {result.operation.name} · {result.response.status}</summary>
          {@render responseDetails(result.response, `Step ${result.step} response`)}
          <div class="json-report" role="region" aria-label={`Step ${result.step} prepared request`}><pre>{JSON.stringify(result.request, null, 2)}</pre></div>
        </details>
      {/each}
    </section>
  {/if}
  <footer>
    {#if busy}<button type="button" class="run-primary" onclick={() => runner?.cancelPending()}>Cancel request</button>{/if}
    {#if view?.kind === "choice" && !fatal}
      <button type="button" class="run-primary run-action" onclick={start} disabled={!selected}>
        <span>Start</span><MaterialIcon name="start" size={20} />
      </button>
    {:else if view?.kind === "operation" && !fatal && !executed}
      <button type="submit" form={operationFormId} class="run-primary run-action" disabled={busy}>
        <span>{busy ? "Sending request…" : retry ? "Retry operation" : history.length ? "Run operation" : "Start workflow"}</span><MaterialIcon name="start" size={20} />
      </button>
    {/if}
    <button type="button" class="run-primary run-action" onclick={end}>
      <MaterialIcon name="exit_to_app" size={20} /><span>Quit</span>
    </button>
  </footer>
</div>

<style>
  .workflow-run { display: grid; gap: 20px; min-width: 0; }
  .run-endpoint { margin: 0; padding: 12px; border-left: 3px solid var(--color-emphasis); background: var(--color-report-card); font-size: 12px; line-height: 1.6; }
  .run-request { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  h3[tabindex="-1"] { outline: none; }
  .run-choices { display: grid; gap: 8px; margin: 12px 0; }
  .run-choices label { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 4px; background: var(--color-report-card); }
  .workflow-run :global(.operation-fields) { margin: 16px 0; --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .workflow-run :global(.operation-fields .field-input::placeholder) { color: var(--color-muted-foreground); }
  .workflow-run :global(.operation-fields .field-select-value.placeholder) { color: var(--color-muted-foreground); }
  .workflow-run :global(.operation-title) { margin: 0; font-size: 12px; }
  .workflow-run :global(#run-operation-details .detail-report) { margin-top: 0; }
  .run-response { min-width: 0; }
  .run-status { margin-bottom: 12px; }
  .run-response-body pre { margin: 0; padding: 12px; background: var(--color-report-card); white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 ui-monospace, monospace; }
  .json-report { margin-bottom: 0; }
  button { border: 1px solid var(--color-surface); border-radius: 4px; padding: 9px 14px; color: var(--color-foreground); background: transparent; }
  button.run-primary { background: var(--color-foreground); color: var(--color-background); }
  button.run-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; }
  .run-success { font-size: 12px; }
  .run-error { margin: 0; padding: 12px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; line-height: 1.6; }
  .run-results { min-width: 0; display: grid; gap: 12px; }
  summary { cursor: pointer; padding: 10px 0; font-size: 12px; font-weight: 700; }
  footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--color-surface); }
</style>
