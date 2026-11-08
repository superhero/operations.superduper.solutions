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
  import BinaryResponse from "./BinaryResponse.svelte";
  import "../reports/reports.css";
  import type { InputField } from "$lib/catalog.ts";
  import { catalogForOperation } from "$lib/catalog-registry.ts";
  import VaultVariableAccess from "$lib/components/VaultVariableAccess.svelte";
  import { InputValidationError, prepareRequest, type InputValues } from "$lib/operation-input.ts";
  import type { WorkflowDocument } from "$lib/workflow-document.ts";
  import { createWorkflowRunner, type WorkflowStep, type WorkflowExecution, type WorkflowStream } from "$lib/workflow-runner.ts";
  import { WorkflowResponseError, workflowExecutionForOperation, type WorkflowResponse } from "$lib/workflow-execution.ts";
  import type { ResponseProgress } from "$lib/workflow-response-stream.ts";
  import type { NativeMcpOAuthNotice } from '$lib/native-mcp-oauth.ts';
  import type { NativeCommandProgress } from '$lib/native-command.ts';
  import type { NativeThreadShellNotice } from '$lib/native-thread-shell.ts';
  import type { NativeRequest, NativeResponse, NativeInteraction, NativeAgentProgress } from "$lib/native-agent-contract.ts";
  import type { NativeWorkflowBinding } from "$lib/secrets/native-runtime-config.ts";
  import { prepareNativeRequest } from "$lib/native-operation-input.ts";
  import { replyNativeInteraction, replyNativeCommand, vaultCall } from "$lib/secrets/client.ts";
  import { nativeWorkflowSelection } from '$lib/secrets/native-runtime-client.ts';
  import NativeRuntimeSelector from "$lib/components/NativeRuntimeSelector.svelte";
  import DockerHostSelector from "$lib/components/DockerHostSelector.svelte";
  import type { DockerBinding } from "$lib/secrets/docker-config.ts";
  import { prepareDockerReadRequest } from "$lib/docker-operation-input.ts";
  import OperationCapabilities from "$lib/components/OperationCapabilities.svelte";
  import { chartResultKey, type ChartData, type ChartSnapshot } from "$lib/workflow-chart.ts";
  import WorkflowChartView from "./WorkflowChartView.svelte";
  import { createChartInspection, type ChartInspection } from "$lib/workflow-chart-interaction.ts";

  let { document, onClose, startingNodeId, onBindingChange = () => {}, onNativeBindingChange = () => {}, onDockerBindingChange = () => {} }: { document: WorkflowDocument; onClose: () => void;
    startingNodeId?: string; onBindingChange?: (path: string[], binding: CredentialBinding) => void;
    onNativeBindingChange?: (path: string[], binding: NativeWorkflowBinding) => void;
    onDockerBindingChange?: (path: string[], binding: DockerBinding | undefined) => void } = $props();
  const operationFormId = $props.id();
  const inspections = new Map<string, ChartInspection>();
  function inspectionFor(key: string) {
    if (!inspections.has(key)) inspections.set(key, createChartInspection());
    return inspections.get(key)!;
  }
  let runner: ReturnType<typeof createWorkflowRunner> | undefined;
  let view = $state<WorkflowStep>();
  let values = $state<InputValues>({});
  let credentialBinding = $state<CredentialBinding>();
  let nativeBinding = $state<NativeWorkflowBinding>(), nativeApprovals = $state<NativeInteraction[]>([]);
  let nativeAccountLogin = $state<Extract<NativeAgentProgress, { kind: 'login' }>>();
  let nativeGatewayLogin = $state<Extract<NativeAgentProgress, { kind: 'gateway-login' }>>();
  let nativeMcpLogin = $state<NativeMcpOAuthNotice | null>(null);
  let nativeCommandApproval = $state<NativeCommandProgress | null>(null);
  let nativeShellApproval = $state<NativeThreadShellNotice | null>(null);
  let nativeActionApproval = $state<Extract<NativeAgentProgress, { kind: 'account-action-approval' }> | null>(null);
  let nativeGuardianApproval = $state<Extract<NativeAgentProgress, { kind: 'guardian-approval' }> | null>(null);
  let nativeGuardianDenials = $state<(Extract<NativeAgentProgress, { kind: 'guardian-denial' }> & { runtimeId: string })[]>([]);
  let nativeTurn = $state<Extract<NativeAgentProgress, { kind: 'running' }> | null>(null);
  let nativeSteerText = $state(''), nativeControlStatus = $state(''), nativeControlBusy = $state(false);
  let dockerBinding = $state<DockerBinding>(), dockerReady = $state(false);
  let selected = $state("");
  let error = $state("");
  let fieldError = $state<InputValidationError | null>(null);
  let prepared = $state<ReturnType<typeof prepareRequest> | NativeRequest | null>(null);
  let failedResponse = $state<WorkflowResponse | null>(null);
  let operationDetails = $state(false);
  let operationDescription = $state(false);
  let executed = $state(false);
  let currentStreamId = $state("");
  let streams = $state<WorkflowStream[]>([]);
  let fatal = $state(false);
  let busy = $state(false);
  let sending = $state(false);
  let responseProgress = $state<ResponseProgress | null>(null);
  let retry = $state(false);
  let disposed = false;
  let history = $state<WorkflowExecution[]>([]);
  let heading = $state<HTMLHeadingElement>();
  const destination = $derived.by(() => {
    if (view?.kind !== "operation" || view.operation.protocol === "json-rpc" || view.operation.dockerNative && (!dockerReady || dockerBinding)) return;
    try { return workflowExecutionForOperation(view.operation); } catch (cause) { if (!view.operation.dockerNative) throw cause; }
  });

  let processingResults = $state<ReturnType<typeof createWorkflowRunner>["processingResults"]>([]);
  let chartResults = $state<ChartSnapshot[]>([]);
  let activeTab = $state("forms");
  type RunView = { key: string; title: string; data: ChartData };
  function collectViews(workflow: WorkflowDocument, path: string[] = [], prefix = ""): RunView[] {
    return workflow.nodes.flatMap(node => node.hidden ? [] : node.type === "chart"
      ? [{ key: chartResultKey(workflow.id, node.id, path), title: prefix + node.data.title, data: node.data }]
      : node.type === "workflow" ? collectViews(node.data.snapshot, [...path, node.id], `${prefix}${node.data.name} / `) : []);
  }
  const views = $derived(collectViews(document));
  const activeView = $derived(views.find(item => item.key === activeTab));
  function wheelTabs(element: HTMLDivElement) {
    const scroll = (event: WheelEvent) => {
      // Leave horizontal trackpad input, Shift scrolling and browser zoom native.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.deltaX || !event.deltaY || element.scrollWidth <= element.clientWidth) return;
      const unit = event.deltaMode === 1 ? Number.parseFloat(getComputedStyle(element).lineHeight) || 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      const before = element.scrollLeft;
      element.scrollLeft += event.deltaY * unit;
      if (element.scrollLeft !== before) event.preventDefault();
    };
    element.addEventListener("wheel", scroll, { passive: false });
    return { destroy() { element.removeEventListener("wheel", scroll); } };
  }
  function tabKeys(event: KeyboardEvent) {
    const keys = ["forms", ...views.map(item => item.key)], index = keys.indexOf(activeTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1
      : event.key === "ArrowRight" ? (index + 1) % keys.length : event.key === "ArrowLeft" ? (index + keys.length - 1) % keys.length : -1;
    if (next < 0) return;
    event.preventDefault(); activeTab = keys[next]!;
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  let processingLocked = $state(false);
  let resultsOpen = $state(false);
  let advanceRevision = 0;
  async function advance()
  {
    const request = ++advanceRevision;
    busy = true;
    processingLocked = false;
    error = "";
    fieldError = null;
    prepared = null;
    failedResponse = null;
    operationDetails = false;
    operationDescription = false;
    executed = false;
    currentStreamId = "";
    retry = false;
    responseProgress = null;
    nativeApprovals = []; nativeTurn = null; nativeSteerText = ''; nativeControlStatus = ''; nativeControlBusy = false; nativeAccountLogin = undefined; nativeGatewayLogin = undefined; nativeMcpLogin = null;
    try
    {
      const next = await runner!.nextAsync();
      if (disposed || request !== advanceRevision) return;
      view = next;
      processingResults = runner!.processingResults;
      chartResults = runner!.chartResults;
      streams = runner!.streams;
      credentialBinding = view.kind === "operation" ? view.credentialBinding : undefined;
      nativeBinding = view.kind === "operation" ? view.nativeBinding : undefined;
      dockerBinding = view.kind === "operation" ? view.dockerBinding : undefined; dockerReady = false;
      values = view.kind === "operation" ? { ...view.values } : {};
      selected = view.kind === "choice" ? view.choices[0]?.id ?? "" : "";
      void tick().then(() => { if (activeTab === "forms") heading?.focus(); });
    }
    catch (cause) {
      if (disposed || request !== advanceRevision) return;
      error = cause instanceof Error ? cause.message : "The workflow could not continue.";
      processingLocked = !!cause && typeof cause === "object" && "code" in cause && cause.code === "LOCKED";
      fatal = !processingLocked;
    }
    finally { if (!disposed && request === advanceRevision) busy = false; }
  }

  function start()
  {
    try { runner!.choose(selected); advance(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Choose a starting operation."; }
  }

  function recordExecution(result: WorkflowExecution) {
    if (!history.some(item => item.step === result.step)) history = [...history, result];
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
    sending = true;
    responseProgress = null;
    try
    {
      const submittedValues = { ...values };
      if (!view.vaultVariables?.length) prepared = view.operation.protocol === "json-rpc" ? prepareNativeRequest(view.operation, submittedValues)
        : dockerBinding ? prepareDockerReadRequest(view.operation, submittedValues) : prepareRequest(view.operation, submittedValues);
      const visitId = view.id, nativeRuntimeId = nativeBinding?.runtime.id;
      const result = await runner!.submit(submittedValues, credentialBinding ?? null, progress => {
        if (!disposed && view?.kind === "operation" && view.id === visitId && sending) responseProgress = progress;
      }, nativeBinding ?? null, progress => {
        if (!disposed && view?.kind === "operation" && view.id === visitId && sending) {
          if (progress.kind === "approval") nativeApprovals = [...nativeApprovals, progress.interaction];
          if (progress.kind === 'login') { nativeAccountLogin = progress; activeTab = 'forms'; }
          if (progress.kind === 'gateway-login') { nativeGatewayLogin = progress; activeTab = 'forms'; }
          if (progress.kind === "mcp-login") { nativeMcpLogin = progress; activeTab = "forms"; }
          if (progress.kind === 'command-approval') { nativeCommandApproval = progress; activeTab = 'forms'; }
          if (progress.kind === 'account-action-approval') { nativeActionApproval = progress; activeTab = 'forms'; }
          if (progress.kind === 'guardian-approval') { nativeGuardianApproval = progress; activeTab = 'forms'; }
          if (progress.kind === 'guardian-denial' && nativeRuntimeId) nativeGuardianDenials = [...nativeGuardianDenials.filter(denial => denial.reviewId !== progress.reviewId || denial.runtimeId !== nativeRuntimeId), { ...progress, runtimeId: nativeRuntimeId }].slice(-32);
          if (progress.kind === 'shell-approval') { nativeShellApproval = progress; activeTab = 'forms'; }
          if (progress.kind === 'running') { nativeTurn = progress; activeTab = 'forms'; }
        }
      }, dockerBinding ?? null);
      if (!disposed) {
        streams = runner!.streams;
        if ("request" in result) { prepared = result.request; recordExecution(result); }
        else currentStreamId = result.id;
        executed = true; retry = false;
      }
    }
    catch (cause)
    {
      if (disposed) return;
      error = cause instanceof Error ? cause.message : "The operation could not run.";
      retry = !(cause instanceof InputValidationError);
      if (view?.kind === "operation" && view.operation.protocol === "json-rpc" && !(cause instanceof InputValidationError)) { fatal = true; retry = false; }
      if (cause instanceof WorkflowResponseError) failedResponse = cause.response;
      if (cause instanceof InputValidationError)
      {
        fieldError = cause;
        busy = false;
        await tick();
        globalThis.document.getElementById(`run-${cause.fieldKey}`)?.focus();
      }
    }
    finally { busy = false; sending = false; responseProgress = null; nativeApprovals = []; nativeTurn = null; nativeSteerText = ''; nativeControlStatus = ''; nativeControlBusy = false; nativeAccountLogin = undefined; nativeGatewayLogin = undefined; nativeMcpLogin = null; nativeCommandApproval = null; nativeShellApproval = null; nativeActionApproval = null; nativeGuardianApproval = null; }
  }

  async function sendNativeTurnControl(method: 'turn/interrupt' | 'turn/steer') {
    if (!nativeBinding || !nativeTurn || nativeControlBusy) return;
    const owned = nativeTurn, runtime = nativeBinding.runtime;
    nativeControlBusy = true; nativeControlStatus = '';
    try {
      const selections = await nativeWorkflowSelection(), selection = selections.find(item => item.operation.rpc?.method === method);
      if (!selection) throw new Error('Native turn control is unavailable.');
      const params = method === 'turn/interrupt' ? { threadId: owned.threadId, turnId: owned.turnId }
        : { threadId: owned.threadId, expectedTurnId: owned.turnId, input: [{ type: 'text', text: nativeSteerText }] };
      await vaultCall('controlNativeTurn', [runtime, selections, selection, params]);
      if (nativeTurn?.threadId === owned.threadId && nativeTurn.turnId === owned.turnId) {
        nativeControlStatus = method === 'turn/interrupt' ? 'Stop acknowledged.' : 'Instruction sent.';
        if (method === 'turn/steer') nativeSteerText = '';
      }
    } catch (failure) {
      if (nativeTurn?.threadId === owned.threadId && nativeTurn.turnId === owned.turnId) nativeControlStatus = failure instanceof Error ? failure.message : 'Native turn control failed.';
    } finally { nativeControlBusy = false; }
  }

  function edit(field: InputField, value: string | null | undefined) {
    values[field.key] = value; error = ""; prepared = null; failedResponse = null;
    if (fieldError?.fieldKey === field.key) fieldError = null;
  }
  function end() { runner?.end(); onClose(); }

  onMount(() => {
    let unsubscribe: (() => void) | undefined;
    let unsubscribeStreams: (() => void) | undefined;
    try {
      runner = createWorkflowRunner(document, startingNodeId);
      unsubscribe = runner.subscribeCharts(results => { if (!disposed) chartResults = results; });
      unsubscribeStreams = runner.subscribeStreams(results => {
        if (disposed) return;
        streams = results;
        for (const stream of results) if (stream.result) recordExecution(stream.result);
      });
      advance();
    }
    catch (cause) { error = cause instanceof Error ? cause.message : "This workflow cannot be started."; fatal = true; }
    return () => { disposed = true; unsubscribe?.(); unsubscribeStreams?.(); runner?.end(); };
  });
</script>

{#snippet responseDetails(response: WorkflowResponse | NativeResponse, label: string)}
  <section class="run-response" aria-label={label}>
    {#if "protocol" in response}
      <p class="run-status">Native operation completed</p>
      <JsonView value={response.result} label={`${label} JSON`} />
      {#if response.notification}<JsonView value={response.notification} label={`${label} filesystem change`} />{/if}
    {:else}
    <p class="run-status">HTTP {response.status}{response.statusText ? ` ${response.statusText}` : ""}</p>
    <section class="run-response-body" aria-label="Response body">
      {#if response.body === null}<p class="hint">{response.redacted ? "Sensitive response data was withheld." : "No response body."}</p>
      {:else if response.bodyType === "binary"}<BinaryResponse value={response.body} />
      {:else if typeof response.body === "string"}<pre>{response.body}</pre>
      {:else}<JsonView value={response.body} label={`${label} JSON`} />{/if}
    </section>
    {/if}
  </section>
{/snippet}

<div class="workflow-run">
  {#if views.length}
    <div class="run-tabs" use:wheelTabs role="tablist" aria-label="Workflow run views" tabindex="-1" onkeydown={tabKeys}>
      <button type="button" role="tab" id={`${operationFormId}-forms-tab`} aria-controls={`${operationFormId}-forms-panel`}
        aria-selected={activeTab === "forms"} tabindex={activeTab === "forms" ? 0 : -1} onclick={() => activeTab = "forms"}>Forms{error || nativeApprovals.length || nativeMcpLogin || nativeAccountLogin || nativeGatewayLogin || nativeActionApproval || nativeGuardianApproval ? " · Attention" : ""}</button>
      {#each views as item, index (item.key)}
        <button type="button" role="tab" id={`${operationFormId}-view-tab-${index}`} aria-controls={`${operationFormId}-view-panel`}
          aria-selected={activeTab === item.key} tabindex={activeTab === item.key ? 0 : -1} onclick={() => activeTab = item.key}>{item.title}</button>
      {/each}
    </div>
  {/if}
  <div class="run-forms" hidden={activeTab !== "forms"} role={views.length ? "tabpanel" : undefined}
    id={`${operationFormId}-forms-panel`} aria-labelledby={views.length ? `${operationFormId}-forms-tab` : undefined}>
  {#if destination}
    <p class="run-endpoint">Server: <strong>{destination.origin}</strong>. Each confirmed step sends a request to this service.</p>
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
    {@const schemaName = catalogForOperation(view.operation.id)?.name}
    <section aria-label="Current workflow operation">
      <div class="operation-toolbar report-pill context-label">
        <h3 class="operation-title" bind:this={heading} tabindex="-1">{view.step}. {schemaName ? `${schemaName} / ` : ""}{view.operation.name}</h3>
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
      <OperationCapabilities operation={view.operation} requirementsOnly selection={{ credentials: !!credentialBinding, native: !!nativeBinding, docker: dockerReady }} />
      {#if view.operation.protocol === "json-rpc"}
        {#key view.id}<NativeRuntimeSelector operation={view.operation} initial={view.nativeBinding} disabled={busy || executed}
          onChange={binding => { nativeBinding = binding; if (binding && view?.kind === "operation") onNativeBindingChange(view.bindingPath, binding); }} />{/key}
      {/if}
      {#if view.operation.dockerNative}
        {#key view.id}<DockerHostSelector operation={view.operation} initial={view.dockerBinding} disabled={busy || executed}
          onChange={(binding, ready) => {
            dockerBinding = binding; dockerReady = ready; if (binding) credentialBinding = undefined;
            if (ready && view?.kind === "operation") onDockerBindingChange(view.bindingPath, binding);
          }} />{/key}
      {/if}
      {#if view.operation.responseStream}
        <p class="run-stream-progress" role="status" aria-label="Response progress">{currentStreamId ? `Stream ${streams.find(stream => stream.id === currentStreamId)?.state ?? "started"}. You can continue the workflow.` : sending
          ? responseProgress ? `Receiving response · ${responseProgress.events} updates` : "Waiting for response…" : ""}</p>
      {/if}
      {#if view.vaultVariables?.length && (!view.operation.security?.length || credentialBinding && view.operation.security[credentialBinding.alternative]?.length === 0)}<VaultVariableAccess disabled={busy || executed} />{/if}
      <form id={operationFormId} onsubmit={execute} novalidate>
        {#if view.operation.security?.length || view.operation.credentialResultProfile}
          {#key view.id}
            <CredentialBindingSelector operation={view.operation} initial={view.credentialBinding} variables={view.vaultVariables} {values} disabled={busy || executed} portalZIndex={90}
              onChange={binding => {
                credentialBinding = binding;
                if (binding && view?.kind === "operation") onBindingChange(view.bindingPath, binding);
              }} />
          {/key}
        {/if}
        {#if view.operation.rpc?.method === 'account/login/start' && values['params:type'] === 'apiKey'}
          <VaultVariableAccess selected={values['params:credentialId'] ?? ''} disabled={busy || executed}
            onselect={id => edit('params:credentialId', id)} />
        {/if}
        {#key view.id}<OperationFields operation={view.operation} {values} {fieldError} idPrefix="run" portalZIndex={90}
          disabled={busy || executed} mappedFields={view.mappedFields} onValueChange={edit} />{/key}
        {#if executed}
          <p class="run-success" role="status">{currentStreamId ? "Stream started. It will keep updating its views as you continue." : "Operation completed."}</p>
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
  {#if processingLocked}
    <VaultVariableAccess disabled={busy} />
    <button type="button" class="run-primary" disabled={busy} onclick={advance}>Continue</button>
  {/if}
  {#if processingResults.length}
    <details class="run-processing-results" bind:open={resultsOpen}>
      <summary>Processing results ({processingResults.length})</summary>
      {#if resultsOpen}
        {#each processingResults as result, index (`${index}:${result.nodeId}`)}
          <section aria-label={`${result.name} result`}>
            <strong>{result.name}{result.matched === undefined ? "" : result.matched ? " · Success" : " · Failure"}</strong>
            <pre>{result.preview}</pre>
          </section>
        {/each}
      {/if}
    </details>
  {/if}
  {#if failedResponse}{@render responseDetails(failedResponse, "Operation response")}{/if}
  {#if nativeTurn && sending}
    <section aria-label="Running native turn" class="run-response">
      <h3>Agent turn in progress</h3>
      {#if view?.kind === 'operation' && view.operation.rpc?.method === 'turn/start'}
        <label for={`${operationFormId}-native-steer`}>Instruction for the running turn</label>
        <textarea id={`${operationFormId}-native-steer`} aria-label="Instruction for the running turn" bind:value={nativeSteerText} rows={2} maxlength={24576} disabled={nativeControlBusy}></textarea>
        <button type="button" class="run-primary" disabled={nativeControlBusy || !nativeSteerText.trim()} onclick={() => sendNativeTurnControl('turn/steer')}>Send instruction</button>
      {/if}
      <button type="button" class="run-primary" disabled={nativeControlBusy} onclick={() => sendNativeTurnControl('turn/interrupt')}>Stop turn</button>
      {#if nativeControlStatus}<p role="status">{nativeControlStatus}</p>{/if}
    </section>
  {/if}
  {#if nativeAccountLogin && sending}
    <section aria-label="Account sign-in" class="run-response">
      <h3>Sign in to the native runtime</h3>
      <p class="hint">Waiting for the runtime to confirm your account.</p>
      <a href={nativeAccountLogin.login === 'chatgpt' ? nativeAccountLogin.authUrl : nativeAccountLogin.verificationUrl}
        target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open account sign-in</a>
      {#if nativeAccountLogin.login === 'chatgptDeviceCode'}<p>Code: <code>{nativeAccountLogin.userCode}</code></p>{/if}
      <p>Sign-in ID: <code>{nativeAccountLogin.loginId}</code></p>
      <button type="button" onclick={() => runner?.cancelPending()}>Cancel sign-in</button>
    </section>
  {/if}
  {#if nativeGatewayLogin && sending}
    <section aria-label="Gateway sign-in" class="run-response">
      <h3>Sign in to {nativeGatewayLogin.providerId}</h3>
      <p class="hint">Waiting for the native runtime to confirm gateway access.</p>
      <a href={nativeGatewayLogin.authUrl} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open gateway sign-in</a>
      <button type="button" onclick={() => runner?.cancelPending()}>Cancel sign-in</button>
    </section>
  {/if}
  {#if nativeMcpLogin}
    <section aria-label="MCP sign-in" class="run-response">
      <h3>Sign in to {nativeMcpLogin.server}</h3>
      <p class="hint">Waiting for the connected runtime to confirm sign-in.</p>
      <a href={nativeMcpLogin.authorizationUrl} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open MCP sign-in</a>
      <button type="button" onclick={() => runner?.cancelPending()}>Cancel sign-in</button>
    </section>
  {/if}
  {#each nativeApprovals as prompt (prompt.token)}
    <section aria-label="Codex approval" class="run-response">
      <h3>{prompt.kind === "command" ? "Allow this command?" : "Allow this file change?"}</h3>
      {#if prompt.command}<pre>{prompt.command}</pre>{/if}
      {#if prompt.cwd}<p class="hint">Workspace: {prompt.cwd}</p>{/if}
      {#if prompt.reason}<p>{prompt.reason}</p>{/if}
      {#each [{ label: "Allow once", decision: "accept" }, { label: "Decline", decision: "decline" }] as choice}
        <button type="button" onclick={() => {
          if (!nativeBinding) return;
          replyNativeInteraction(nativeBinding.runtime.id, prompt.token, choice.decision as "accept" | "decline");
          nativeApprovals = nativeApprovals.filter(value => value.token !== prompt.token);
        }}>{choice.label}</button>
      {/each}
      <button type="button" onclick={() => runner?.cancelPending()}>Cancel turn</button>
    </section>
  {/each}
  {#if nativeCommandApproval}
    {@const prompt = nativeCommandApproval}
    <section aria-label="Command approval" class="run-response">
      <h3>Allow this command?</h3>
      <JsonView value={prompt.params} label="Command arguments and environment" />
      {#each [{ label: 'Allow once', decision: 'accept' }, { label: 'Decline', decision: 'decline' }] as choice}
        <button type="button" onclick={() => {
          if (!nativeBinding) return;
          replyNativeCommand(nativeBinding.runtime.id, prompt.token, choice.decision as 'accept' | 'decline');
          nativeCommandApproval = null;
        }}>{choice.label}</button>
      {/each}
      <button type="button" onclick={() => runner?.cancelPending()}>Cancel command</button>
    </section>
  {/if}
  {#if view?.kind === 'operation' && view.operation.rpc?.method === 'thread/approveGuardianDeniedAction' && nativeBinding}
    <section aria-label="Observed Guardian denials" class="run-response">
      <h3>Recent denied actions</h3>
      {#each nativeGuardianDenials.filter(denial => denial.runtimeId === nativeBinding?.runtime.id) as denial (denial.reviewId)}
        <p>{denial.actionType} · Review <code>{denial.reviewId}</code></p>
        <button type="button" disabled={sending || busy} onclick={() => { values = { ...values, 'params:threadId': denial.threadId, 'params:reviewId': denial.reviewId }; }}>Select this denial</button>
      {/each}
    </section>
  {/if}
  {#if nativeGuardianApproval}
    {@const prompt = nativeGuardianApproval}
    <section aria-label="Guardian denial approval" class="run-response">
      <h3>Approve this denied action for one retry?</h3>
      <p>{prompt.denial.review.rationale}</p>
      <p>Risk: {prompt.denial.review.riskLevel ?? 'Unknown'} · User authorization: {prompt.denial.review.userAuthorization ?? 'Unknown'}</p>
      <pre>{JSON.stringify(prompt.denial.action, null, 2)}</pre>
      <p class="hint">Approval records permission for a retry. It does not run the action.</p>
      {#each [{ label: 'Approve one retry', decision: 'accept' }, { label: 'Decline', decision: 'decline' }] as choice}
        <button type="button" onclick={() => {
          if (!nativeBinding) return;
          replyNativeInteraction(nativeBinding.runtime.id, prompt.token, choice.decision as 'accept' | 'decline');
          nativeGuardianApproval = null;
        }}>{choice.label}</button>
      {/each}
    </section>
  {/if}
  {#if nativeActionApproval}
    {@const prompt = nativeActionApproval}
    {@const reset = prompt.method === 'account/rateLimitResetCredit/consume'}
    <section aria-label="Account action approval" class="run-response">
      <h3>{reset ? 'Use a rate-limit reset credit?' : 'Email the workspace owner about credits?'}</h3>
      <p>This action uses the ChatGPT account signed in on the selected native runtime.</p>
      {#if prompt.account.account?.type === 'chatgpt' && prompt.account.account.email}
        <p>Account: <strong>{prompt.account.account.email}</strong></p>
      {/if}
      {#if reset}
        <p>Reset credit: <code>{String(prompt.params.creditId ?? 'Next available credit')}</code></p>
        <p>Idempotency key: <code>{String(prompt.params.idempotencyKey)}</code></p>
      {:else}
        <p>Credit type: {prompt.params.creditType === 'usage_limit' ? 'Usage limit' : 'Credits'}</p>
      {/if}
      {#each [{ label: reset ? 'Use reset credit' : 'Send credit email', decision: 'accept' }, { label: 'Decline', decision: 'decline' }] as choice}
        <button type="button" onclick={() => {
          if (!nativeBinding) return;
          replyNativeInteraction(nativeBinding.runtime.id, prompt.token, choice.decision as 'accept' | 'decline');
          nativeActionApproval = null; nativeGuardianApproval = null;
        }}>{choice.label}</button>
      {/each}
    </section>
  {/if}
  {#if nativeShellApproval}
    {@const prompt = nativeShellApproval}
    <section aria-label="Thread shell approval" class="run-response">
      <h3>Run this shell command without a sandbox?</h3>
      <p>This command runs with the runtime user's filesystem and network access.</p>
      <pre>{prompt.command}</pre>
      <p class="hint">Thread: {prompt.threadId} · Timeout: {prompt.timeoutMs} ms</p>
      {#each [{ label: 'Run once without sandbox', decision: 'accept' }, { label: 'Decline', decision: 'decline' }] as choice}
        <button type="button" onclick={() => {
          if (!nativeBinding) return;
          replyNativeInteraction(nativeBinding.runtime.id, prompt.token, choice.decision as 'accept' | 'decline');
          nativeShellApproval = null; nativeActionApproval = null; nativeGuardianApproval = null;
        }}>{choice.label}</button>
      {/each}
      <button type="button" onclick={() => runner?.cancelPending()}>Cancel shell command</button>
    </section>
  {/if}
  {#if prepared && !executed}<div class="json-report" role="region" aria-label="Prepared request"><pre>{JSON.stringify(prepared, null, 2)}</pre></div>{/if}
  {#if history.length}
    <section class="run-results" aria-label="Workflow results">
      <h3>Operation results</h3>
      {#each [...history].reverse() as result (result.step)}
        <details open={result.step === history.at(-1)?.step}>
          <summary>{result.step}. {result.operation.name} · {"protocol" in result.response ? "Completed" : result.response.status}</summary>
          {@render responseDetails(result.response, `Step ${result.step} response`)}
          <div class="json-report" role="region" aria-label={`Step ${result.step} prepared request`}><pre>{JSON.stringify(result.request, null, 2)}</pre></div>
        </details>
      {/each}
    </section>
  {/if}
  </div>
  {#if activeView}
    <div class="run-view-panel" id={`${operationFormId}-view-panel`} role="tabpanel" tabindex="0"
      aria-labelledby={`${operationFormId}-view-tab-${views.indexOf(activeView)}`}>
      <h3>{activeView.title}</h3>
      {#key activeView.key}<WorkflowChartView data={activeView.data} inspection={inspectionFor(activeView.key)}
        snapshot={chartResults.find(result => chartResultKey(result.workflowId, result.nodeId, result.path) === activeView.key)} />{/key}
    </div>
  {/if}
  {#if streams.length}
    <section class="run-streams" aria-label="Workflow streams">
      <h3>Streams · {streams.filter(stream => stream.state === "connecting" || stream.state === "running").length} active</h3>
      {#each streams as stream (stream.id)}
        <div class="run-stream">
          <div><strong>{stream.name}</strong><span class="stream-state">{stream.state}{stream.nativeUpdates !== undefined ? ` · ${stream.nativeUpdates} updates` : stream.progress ? ` · ${stream.progress.events} updates` : ""}</span>
            {#if stream.nativeValue && 'notification' in stream.nativeValue && stream.nativeValue.notification}<JsonView value={stream.nativeValue.notification} label={stream.nativeValue.notification.method === 'command/exec/outputDelta' ? 'Latest command output' : 'Latest filesystem change'} />{/if}
            {#if stream.error}<p class="run-error" role="alert">{stream.error}</p>{/if}</div>
          {#if stream.state === "running" || stream.state === "connecting"}
            <button type="button" aria-label={`Stop stream ${stream.name}`} onclick={() => runner?.stopStream(stream.id)}>Stop stream</button>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
  <footer>
    <button type="button" class="run-primary run-action run-quit" onclick={end}>
      <MaterialIcon name="backspace" size={20} /><span>Quit</span>
    </button>
    {#if busy}<button type="button" class="run-primary" onclick={() => runner?.cancelPending()}>Cancel request</button>{/if}
    {#if activeTab === "forms" && view?.kind === "choice" && !fatal}
      <button type="button" class="run-primary run-action" onclick={start} disabled={!selected}>
        <span>Proceed</span><MaterialIcon name="start" size={20} />
      </button>
    {:else if activeTab === "forms" && view?.kind === "operation" && !fatal && !executed}
      <button type="submit" form={operationFormId} class="run-primary run-action" disabled={busy || view.operation.protocol === "json-rpc" && !nativeBinding || !!view.operation.dockerNative && !dockerReady}>
        <span>{busy ? "Sending request…" : retry ? "Retry operation" : view.step > 1 ? "Run operation" : "Start workflow"}</span><MaterialIcon name="start" size={20} />
      </button>
    {/if}
  </footer>
</div>

<style>
  .workflow-run { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; flex: 1; }
  .run-forms:not([hidden]) { display: grid; gap: 20px; overflow: auto; min-height: 0; flex: 1; }
  .run-tabs { display: flex; overflow-x: auto; gap: 4px; border-bottom: 1px solid var(--color-border); padding-bottom: 6px; }
  .run-tabs button { flex-shrink: 0; }
  .run-tabs button[aria-selected="true"] { background: var(--color-primary); color: var(--color-primary-foreground); }
  .run-view-panel { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; min-width: 0; }
  .run-streams { min-width: 0; max-height: 140px; overflow: auto; flex-shrink: 0; }
  .run-stream { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--color-border); font-size: 12px; }
  .run-stream > div { min-width: 0; }
  .stream-state { display: block; opacity: 0.75; }
  .run-stream-progress { min-height: 18px; margin: 0; font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .run-endpoint { margin: 0; padding: 12px; border-left: 3px solid var(--color-emphasis); background: var(--color-report-card); font-size: 12px; line-height: 1.6; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  h3[tabindex="-1"] { outline: none; }
  .run-choices { display: grid; gap: 8px; margin: 12px 0; }
  .run-choices label { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 4px; background: var(--color-report-card); }
  .workflow-run :global(.operation-fields) { margin: 16px 0; --field-background: var(--color-background); --field-foreground: var(--color-foreground); --control-label: var(--color-background); --control-info: var(--color-background); }
  .workflow-run :global(.operation-fields .field-input::placeholder), .workflow-run :global(.operation-fields .integer-value::placeholder) { color: var(--field-foreground); }
  .workflow-run :global(.field-select-value.placeholder) { color: var(--field-foreground); }
  .workflow-run :global(.operation-title) { margin: 0; font-size: 12px; }
  .workflow-run :global(#run-operation-details .detail-report) { margin-top: 0; }
  .run-response { min-width: 0; }
  .run-status { margin-bottom: 12px; }
  .run-response-body pre { margin: 0; padding: 12px; background: var(--color-report-card); white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 ui-monospace, monospace; }
  .json-report { margin-bottom: 0; }
  button { border: 1px solid var(--color-surface); border-radius: 4px; padding: 9px 14px; color: var(--color-foreground); background: transparent; }
  button.run-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
  button.run-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; }
  button.run-quit { margin-right: auto; background: var(--color-badge-background); color: var(--color-badge-foreground); }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .run-primary:not(:disabled) { will-change: transform; }
    .run-primary:hover:not(:disabled) { transform: scale(min(1.10, var(--hover-scale, 1.10))); }
  }
  .run-success { font-size: 12px; }
  .run-error { margin: 0; padding: 12px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; line-height: 1.6; }
  .run-results { min-width: 0; display: grid; gap: 12px; }
  .run-processing-results { min-width: 0; font-size: 12px; }
  .run-processing-results pre { max-height: 240px; padding: 8px; overflow: auto; white-space: pre; background: var(--color-report-card); }
  summary { cursor: pointer; padding: 10px 0; font-size: 12px; font-weight: 700; }
  footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--color-surface); flex-shrink: 0; }
</style>
