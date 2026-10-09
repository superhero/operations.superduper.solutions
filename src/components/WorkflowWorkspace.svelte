<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, setContext, tick } from "svelte";
  import { Background, BackgroundVariant, ConnectionLineType, MarkerType, SvelteFlow, addEdge, type Edge, type Node, type Connection } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { Button } from "$lib/components/ui/button/index.js";
  import HintButton from "$lib/components/HintButton.svelte";
  import type { Operation } from "$lib/catalog.ts";
  import { loadWorkflowDocuments, saveWorkflowDocument, removeWorkflowDocuments, parseWorkflowDocument, validateWorkflowDocument, maxWorkflowFileSize, type WorkflowDocument, type WorkflowDocumentNode, type WorkflowDocumentEdge, type SwitchGate, type CastData } from "$lib/workflow-document.ts";
  import { createOperationGraph, createUtilityNode, createWorkflowGraph, addSwitchGate, updateSwitchGate, removeSwitchGate, schemaBranches, isWorkflowConnection, removeGraphSelection, restoreDataBranch } from "$lib/workflow-graph.ts";
  import { adaptRoutingGates, routingInputTypes, workflowDescriptionLimit } from "$lib/workflow-utilities.ts";
  import { getOperationReport } from "$lib/operation-report.ts";
  import WorkflowNode from "../WorkflowNode.svelte";
  import WorkflowToolbar from "./workflows/WorkflowToolbar.svelte";
  import WorkflowMinimap from "./workflows/WorkflowMinimap.svelte";
  import WorkflowDataNode from "./workflows/WorkflowDataNode.svelte";
  import WorkflowConnectionSnap from "./workflows/WorkflowConnectionSnap.svelte";
  import WorkflowSwitchNode from "./workflows/WorkflowSwitchNode.svelte";
  import WorkflowCastNode from "./workflows/WorkflowCastNode.svelte";
  import WorkflowCommentNode from "./workflows/WorkflowCommentNode.svelte";
  import WorkflowReferenceNode from "./workflows/WorkflowReferenceNode.svelte";
  import WorkflowRun from "./workflows/WorkflowRun.svelte";
  import Modal from "$lib/components/Modal.svelte";

  let { active, navigationOpen = false, navigationModal = false, documentModal = $bindable(false), documents = $bindable([]), libraryError = $bindable(""), onBrowse }:
    { active: boolean; navigationOpen?: boolean; navigationModal?: boolean; documentModal?: boolean; documents?: WorkflowDocument[]; libraryError?: string; onBrowse: () => void } = $props();
  const nodeTypes = { operation: WorkflowNode, data: WorkflowDataNode, switch: WorkflowSwitchNode, cast: WorkflowCastNode, comment: WorkflowCommentNode, workflow: WorkflowReferenceNode };
  type CanvasNode<T> = T extends WorkflowDocumentNode ? Node<T["data"], NonNullable<T["type"]>> & { type: NonNullable<T["type"]> } : never;
  type GraphNode = CanvasNode<WorkflowDocumentNode>;
  type GraphEdge = Edge & WorkflowDocumentEdge;
  const connectionMarkerId = $props.id();
  let version = $state<1 | 2 | 3>(1);
  let id = $state<string>(crypto.randomUUID());
  let name = $state("Untitled workflow");
  let description = $state("");
  let nodes = $state.raw<GraphNode[]>([]);
  let edges = $state.raw<GraphEdge[]>([]);
  let viewport = $state({ x: 0, y: 0, zoom: 1 });
  let snap = $state(false);
  let curved = $state(false);
  let dashed = $state(false);
  let savedSnapshot = $state("");
  let hasSavedDocument = $state(false);
  let error = $state("");
  let notice = $state("");
  let retry = $state<(() => void) | null>(null);
  let upload: HTMLInputElement;
  let toolbar = $state<WorkflowToolbar>();
  let connectionSnap = $state<WorkflowConnectionSnap>();
  let canvas = $state<HTMLElement>();
  let nameInput: HTMLInputElement;
  let activated = $state(false);
  let dialogOpen = $state(false);
  let descriptionOpen = $state(false);
  let descriptionError = $state("");
  let descriptionInput: HTMLTextAreaElement;
  let runOpen = $state(false);
  let runDocument = $state<WorkflowDocument | null>(null);
  let fileMenuOpen = $state(false);
  let pendingAction = $state<((didSave: boolean) => void) | null>(null);
  let replacementOpen = $state(false);
  let replacementError = $state("");
  let cancelReplacement = $state<HTMLButtonElement | null>(null);
  let removal = $state<WorkflowDocument[] | null>(null);
  let selectedDocuments = $state<string[]>([]);
  let removalError = $state("");
  let cancelRemoval = $state<HTMLButtonElement | null>(null);
  let intent = 0;
  let replacementCompleted = false;
  let replacementReturnToCanvas = false;
  let revision = $state(0);
  const selected = $derived(nodes.some(node => node.selected) || edges.some(edge => edge.selected));
  const graphBlocked = $derived(!active || navigationModal || dialogOpen || replacementOpen || descriptionOpen || runOpen);
  const keyboardActive = $derived(!graphBlocked && !fileMenuOpen);
  const snapshot = $derived(JSON.stringify(documentValue()));
  const dirty = $derived(snapshot !== savedSnapshot);
  const edgeOptions = $derived({ animated: dashed, markerEnd: { type: MarkerType.ArrowClosed }, type: curved ? "default" : "smoothstep", style: dashed ? "stroke-dasharray: 6 4" : "" });
  const branches = $derived(schemaBranches(nodes, edges));
  const inputTypes = $derived(routingInputTypes(nodes, edges));

  setContext("workflow-branches", (nodeId: string) => branches.get(nodeId));
  setContext("workflow-editor-active", () => keyboardActive);
  setContext("workflow-input-type", (nodeId: string) => inputTypes.get(nodeId) ?? "Unknown");
  setContext("workflow-switch-gates", {
    add: (nodeId: string) => { if (keyboardActive) applyGraph(addSwitchGate(nodeId, crypto.randomUUID(), nodes, edges)); },
    remove: (nodeId: string, gateId: string) => { if (keyboardActive) applyGraph(removeSwitchGate(nodeId, gateId, nodes, edges), true); },
    edit: (nodeId: string, gateId: string, patch: Partial<Pick<SwitchGate, "operator" | "value">>) => {
      if (keyboardActive) applyGraph(updateSwitchGate(nodeId, gateId, patch, nodes, edges));
    }
  });
  setContext("workflow-cast-type", (nodeId: string, targetType: CastData["targetType"]) => {
    if (keyboardActive) applyGraph({ nodes: nodes.map(node => node.id === nodeId && node.type === "cast" ? { ...node, data: { targetType } } : node), edges }, true);
  });
  setContext("workflow-comment-text", (nodeId: string, text: string) => {
    if (keyboardActive) nodes = nodes.map(node => node.id === nodeId && node.type === "comment" ? { ...node, data: { text } } : node);
  });
  setContext("workflow-restore-branch", (nodeId: string) => {
    if (!keyboardActive) return;
    applyGraph(restoreDataBranch(nodeId, nodes, edges), true);
  });
  setContext("workflow-hide-branch", (nodeId: string) => {
    if (!keyboardActive) return;
    applyGraph(removeGraphSelection({ nodes: [{ id: nodeId }], edges: [] }, nodes, edges), true);
  });

  $effect(() => { if (active) activated = true; });
  $effect(() => { documentModal = dialogOpen || replacementOpen || descriptionOpen || runOpen; });
  $effect(() => { if (graphBlocked) fileMenuOpen = false; });
  $effect(() => { if (dirty) notice = ""; });
  $effect(() => {
    if (!replacementOpen && pendingAction) { pendingAction = null; replacementError = ""; intent += 1; }
  });

  function documentValue(): WorkflowDocument {
    return { version, id, name, ...(version === 3 ? { description } : {}), nodes: nodes.map(storedNode),
      edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
        ...(version >= 2 ? { ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
          ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}), ...(edge.kind ? { kind: edge.kind } : {}),
          ...(edge.hidden ? { hidden: true } : {}), ...(edge.detached ? { detached: true } : {}) } : {}) })),
      viewport: { ...viewport }, snap, curved, dashed };
  }

  function storedNode(node: GraphNode): WorkflowDocumentNode {
    const common = { id: node.id, position: node.position, ...(node.hidden ? { hidden: true } : {}) };
    if (node.type === "operation") return { ...common, ...(version >= 2 ? { type: "operation" as const } : {}), data: node.data };
    return { ...common, type: node.type, data: node.data } as WorkflowDocumentNode;
  }

  function graphNode(node: WorkflowDocumentNode): GraphNode {
    return { ...node, type: node.type ?? "operation" } as GraphNode;
  }

  function paintEdge(edge: WorkflowDocumentEdge): GraphEdge {
    return { ...edge, ...edgeOptions, ...(edge.kind === "schema" ? { class: "workflow-schema-edge" } : {}) };
  }

  function applyGraph(graph: Pick<WorkflowDocument, "nodes" | "edges">, adapt = false) {
    nodes = (adapt ? adaptRoutingGates(graph.nodes, graph.edges) : graph.nodes).map(node => ({ ...graphNode(node), ...(node.hidden ? { selected: false } : {}) }));
    edges = graph.edges.map(edge => ({ ...paintEdge(edge), ...(edge.hidden ? { selected: false } : {}) }));
  }

  function validConnection(connection: Connection | GraphEdge): boolean {
    return keyboardActive && !branches.get(connection.target)?.get(connection.targetHandle ?? "")?.hidden &&
      isWorkflowConnection(connection, nodes, edges);
  }

  function describeFailure(action: string, failure: unknown) {
    error = `${action}: ${failure instanceof Error ? failure.message : String(failure)}`;
  }

  function hydrate(document: WorkflowDocument, saved: boolean, stored = saved, focus: "name" | "canvas" | null = null) {
    version = document.version;
    id = document.id;
    name = document.name;
    description = document.description ?? "";
    viewport = document.viewport;
    snap = document.snap;
    curved = document.curved;
    dashed = document.dashed;
    applyGraph(document);
    savedSnapshot = saved ? JSON.stringify(documentValue()) : "";
    hasSavedDocument = stored;
    revision += 1;
    error = notice = ""; retry = null;
    if (focus) void tick().then(() => { if (active) { if (focus === "name") nameInput?.focus(); else focusCanvas(); } });
  }

  onMount(() => {
    savedSnapshot = JSON.stringify(documentValue());
    refreshDocuments(true);
    const refresh = (event: StorageEvent) => { if (event.storageArea === localStorage) refreshDocuments(); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  });

  export function refreshDocuments(restoreLatest = false): boolean {
    try {
      documents = loadWorkflowDocuments(localStorage);
      selectedDocuments = selectedDocuments.filter(id => documents.some(document => document.id === id));
      libraryError = "";
      if (restoreLatest && !nodes.length && !dirty) {
        const latest = documents.at(-1);
        if (latest) hydrate(latest, true);
      }
      if (retry) { error = ""; retry = null; }
      return true;
    } catch (failure) {
      describeFailure("Could not load saved workflows", failure);
      libraryError = error;
      retry = () => refreshDocuments(restoreLatest);
      return false;
    }
  }

  const insertionPosition = () => ({ x: (180 - viewport.x) / viewport.zoom, y: (180 - viewport.y) / viewport.zoom });

  async function appendGraph(graph: Pick<WorkflowDocument, "nodes" | "edges">, nodeId: string, title: string, requiredVersion: 2 | 3) {
    try {
      if (nodes.length + graph.nodes.length > 500 || edges.length + graph.edges.length > 1000)
        throw new Error("A workflow supports at most 500 nodes and 1000 connections, including its schema panels.");
      const visible = nodes.filter(node => !node.hidden);
      if (visible.length) {
        const bottom = Math.max(...visible.map(node => node.position.y + (node.measured?.height ?? 80)));
        const top = Math.min(...graph.nodes.filter(node => !node.hidden).map(node => node.position.y));
        const offset = Math.max(0, bottom + 80 - top);
        graph.nodes = graph.nodes.map(node => ({ ...node, position: { x: node.position.x, y: node.position.y + offset } }));
      }
      const current = documentValue();
      validateWorkflowDocument({ ...current, version: Math.max(version, requiredVersion), nodes: [...current.nodes, ...graph.nodes], edges: [...current.edges, ...graph.edges] });
    } catch (failure) { describeFailure(`Could not add “${title}”`, failure); return; }
    version = Math.max(version, requiredVersion) as 2 | 3;
    nodes = [...nodes.map(node => ({ ...node, selected: false })), ...graph.nodes.map(node => ({ ...graphNode(node), selected: node.id === nodeId }))];
    edges = [...edges.map(edge => ({ ...edge, selected: false })), ...graph.edges.map(paintEdge)];
    error = "";
    notice = "";
    await tick();
    await toolbar?.reveal(graph.nodes.filter(node => !node.hidden).map(node => node.id));
    if (active && !navigationModal) focusCanvas();
  }

  export async function addOperation(operation: Operation) {
    if (documentModal) return;
    const nodeId = crypto.randomUUID();
    let schema: Record<string, unknown> | undefined;
    try { schema = getOperationReport(operation).schema; }
    catch { /* The graph shows an unavailable-schema notice for unbundled operations. */ }
    try { await appendGraph(createOperationGraph(operation, insertionPosition(), nodeId, schema), nodeId, operation.name, 2); }
    catch (failure) { describeFailure(`Could not add “${operation.name}”`, failure); }
  }

  async function addUtility(type: "switch" | "cast" | "comment") {
    if (!keyboardActive) return;
    const nodeId = crypto.randomUUID();
    await appendGraph({ nodes: [createUtilityNode(type, insertionPosition(), nodeId)], edges: [] }, nodeId, type, 3);
  }

  export async function addWorkflow(document: WorkflowDocument) {
    if (documentModal) return;
    const nodeId = crypto.randomUUID();
    try { await appendGraph(createWorkflowGraph(document, insertionPosition(), nodeId), nodeId, document.name, 3); }
    catch (failure) { describeFailure(`Could not add “${document.name}”`, failure); }
  }

  export function startRun(document: WorkflowDocument = documentValue()) {
    try {
      runDocument = validateWorkflowDocument(document);
      runOpen = true;
      error = "";
    } catch (failure) { describeFailure("Could not run this workflow", failure); }
  }

  function describeWorkflow() { descriptionError = ""; descriptionOpen = true; }

  function saveDescription() {
    version = 3;
    if (save()) { descriptionOpen = false; descriptionError = ""; }
    else descriptionError = error;
  }

  function prepareConnection(connection: Connection): GraphEdge | null {
    if (!validConnection(connection) || connectionSnap?.acceptsConnection() === false) return null;
    if (edges.length >= 1000) { error = "A workflow supports at most 1000 connections."; return null; }
    const fieldMapping = !!connection.sourceHandle || !!connection.targetHandle;
    error = "";
    return paintEdge({ id: crypto.randomUUID(), source: connection.source, target: connection.target,
      ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
      ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
      ...(fieldMapping ? { kind: "mapping" } : {}) });
  }

  function connectToPanel(connection: Connection) {
    const edge = prepareConnection(connection);
    if (edge) { edges = addEdge(edge, edges); adaptGates(); }
  }

  function adaptGates() { nodes = adaptRoutingGates(nodes, edges).map(graphNode); }

  function removeSelected() {
    applyGraph(removeGraphSelection({ nodes: nodes.filter(node => node.selected), edges: edges.filter(edge => edge.selected) }, nodes, edges), true);
  }

  async function beforeDelete(selection: { nodes: GraphNode[]; edges: GraphEdge[] }) {
    if (keyboardActive) applyGraph(removeGraphSelection(selection, nodes, edges), true);
    return false;
  }

  function switchCurve() {
    curved = !curved;
    edges = edges.map(edge => ({ ...edge, type: curved ? "default" : "smoothstep" }));
  }

  function switchDashes() {
    dashed = !dashed;
    edges = edges.map(edge => ({ ...edge, animated: dashed, style: dashed ? "stroke-dasharray: 6 4" : "" }));
  }

  function save(inConfirmation = false): boolean {
    try {
      saveWorkflowDocument(localStorage, documentValue());
      documents = loadWorkflowDocuments(localStorage);
      savedSnapshot = snapshot;
      hasSavedDocument = true;
      error = libraryError = ""; retry = null;
      notice = "Saved in this browser.";
      return true;
    } catch (failure) {
      const message = `Could not save “${name}”: ${failure instanceof Error ? failure.message : String(failure)}`;
      if (inConfirmation) replacementError = message;
      else { error = message; retry = () => { save(); }; }
      return false;
    }
  }

  function replace(action: (didSave: boolean) => void, returnToCanvas = false) {
    if (dirty) { pendingAction = action; replacementReturnToCanvas = returnToCanvas; replacementError = ""; replacementOpen = true; }
    else action(false);
  }

  function newDocument() {
    intent += 1;
    replace(() => hydrate({ version: 1, id: crypto.randomUUID(), name: "Untitled workflow", nodes: [], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false }, true, false, "name"));
  }

  function openDocuments() {
    intent += 1;
    refreshDocuments();
    removal = null; removalError = ""; selectedDocuments = []; dialogOpen = true;
  }

  function openDocument(document: WorkflowDocument) {
    intent += 1;
    replacementCompleted = true;
    dialogOpen = false;
    replace(didSave => hydrate(didSave && document.id === id ? documentValue() : document, true, true, "canvas"), true);
  }

  async function removeDocuments() {
    if (!removal) return;
    const requested = removal;
    try {
      removeWorkflowDocuments(localStorage, removal.map(document => document.id));
      documents = loadWorkflowDocuments(localStorage);
      if (removal.some(document => document.id === id)) { savedSnapshot = ""; hasSavedDocument = false; }
      selectedDocuments = selectedDocuments.filter(id => documents.some(document => document.id === id));
      removal = null;
      removalError = "";
      await tick();
      window.document.querySelector<HTMLElement>(".document-entry, .modal-close")?.focus();
    } catch (failure) { removalError = `Could not remove ${requested.length === 1 ? `“${requested[0]!.name}”` : `${requested.length} saved workflows`}: ${failure instanceof Error ? failure.message : String(failure)}`; }
  }

  function exportDocument() {
    try {
      const document = validateWorkflowDocument(documentValue());
      const file = new Blob([JSON.stringify(document)], { type: "application/json" });
      if (file.size > maxWorkflowFileSize) throw new Error("Workflow documents must be smaller than 2 MB. Reduce this plan before exporting it.");
      const url = URL.createObjectURL(file);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${document.name.replace(/[^a-z0-9-]/gi, "-") || "workflow"}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      error = "";
    } catch (failure) { describeFailure("Could not export this workflow", failure); }
  }

  async function importDocument(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const generation = ++intent;
    try {
      if (file.size > maxWorkflowFileSize) throw new Error("Workflow documents must be smaller than 2 MB.");
      const document = parseWorkflowDocument(await file.text());
      if (generation !== intent) return;
      document.id = crypto.randomUUID();
      replace(() => hydrate(document, false, false, "canvas"));
    } catch (failure) { if (generation === intent) describeFailure(`Could not import “${file.name}”`, failure); }
  }

  function continueReplacement(shouldSave: boolean) {
    if (shouldSave && !save(true)) return;
    const action = pendingAction;
    pendingAction = null;
    replacementCompleted = true;
    replacementOpen = false;
    replacementError = "";
    action?.(shouldSave);
  }

  function restoreReplacementFocus(event: Event) {
    if (replacementCompleted || replacementReturnToCanvas) event.preventDefault();
    if (!replacementCompleted && replacementReturnToCanvas) void tick().then(focusCanvas);
    replacementCompleted = false;
    replacementReturnToCanvas = false;
  }

  async function confirmRemoval(documents: WorkflowDocument[]) {
    removal = documents;
    removalError = "";
    await tick();
    cancelRemoval?.focus();
  }

  async function cancelRemove() {
    const id = removal?.[0]?.id;
    removal = null;
    removalError = "";
    await tick();
    const row = [...window.document.querySelectorAll<HTMLElement>(".saved-documents li")].find(row => row.dataset.documentId === id);
    row?.querySelector<HTMLElement>("button")?.focus();
  }

  export function focusCanvas() {
    if (graphBlocked) return;
    (canvas?.querySelector<HTMLElement>(".svelte-flow__node.selected") ?? canvas)?.focus({ preventScroll: true });
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  }

  function documentSummary(document: WorkflowDocument): string {
    const nested = document.nodes.filter(node => node.type === "workflow").length;
    return `${document.nodes.filter(node => !node.type || node.type === "operation").length} operations${nested ? ` · ${nested} workflows` : ""} · ${document.edges.filter(edge => edge.kind !== "schema").length} connections`;
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />

<section class="workflow-workspace" class:populated={nodes.length > 0} tabindex="-1" aria-label="Workflow canvas" inert={graphBlocked} bind:this={canvas}>
  {#if activated}
  {#key revision}
    <SvelteFlow bind:nodes bind:edges bind:viewport {nodeTypes} defaultEdgeOptions={edgeOptions} connectionLineType={curved ? ConnectionLineType.Bezier : ConnectionLineType.SmoothStep} onbeforeconnect={prepareConnection} onconnect={adaptGates}
      defaultMarkerColor={null} connectionLineStyle={`marker-end: url(#${connectionMarkerId})`}
      minZoom={0.25} maxZoom={2} snapGrid={snap ? [24, 24] : [1, 1]}
      deleteKey={keyboardActive ? ["Backspace", "Delete"] : null} selectionKey={keyboardActive ? "Shift" : null}
      multiSelectionKey={keyboardActive ? ["Meta", "Control"] : null} panActivationKey={keyboardActive ? " " : null}
      zoomActivationKey={keyboardActive ? ["Meta", "Control"] : null} disableKeyboardA11y={!keyboardActive}
      isValidConnection={validConnection} onbeforedelete={beforeDelete}
      onconnectstart={() => connectionSnap?.start()}
      onclickconnectstart={() => connectionSnap?.start()}
      onconnectend={(event, connection) => { const candidate = connectionSnap?.drop(event, connection); if (candidate) connectToPanel(candidate); }}
      proOptions={{ hideAttribution: true }}>
      <svg width="0" height="0" aria-hidden="true">
        <defs><marker id={connectionMarkerId} markerWidth="12.5" markerHeight="12.5" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
          <polyline points="-5,-4 0,0 -5,4 -5,-4" fill="context-stroke" stroke="context-stroke" stroke-linecap="round" stroke-linejoin="round" />
        </marker></defs>
      </svg>
      <Background variant={BackgroundVariant.Dots} gap={24} size={2} />
      <WorkflowConnectionSnap bind:this={connectionSnap} isValidConnection={validConnection} active={keyboardActive} {curved} {dashed} markerEnd={`url(#${connectionMarkerId})`} />
      {#if nodes.length}<WorkflowMinimap active={keyboardActive} />{/if}
      <WorkflowToolbar bind:this={toolbar} bind:menuOpen={fileMenuOpen} {canvas} {active} {navigationOpen} {snap} {curved} {dashed} {selected}
        onsnap={() => snap = !snap} oncurved={switchCurve} ondashed={switchDashes}
        onremove={removeSelected} onnew={newDocument} onopen={openDocuments} onsave={() => save()}
        onexport={exportDocument} onimport={() => upload.click()} onbrowse={onBrowse}
        onutility={addUtility} ondescribe={describeWorkflow} onrun={() => startRun()} />
    </SvelteFlow>
  {/key}
  {/if}
  <div class="document-meta">
    <input bind:this={nameInput} aria-label="Workflow name" maxlength={100} bind:value={name} />
    <span class:unsaved={dirty} class:fresh={!dirty && !hasSavedDocument}><i aria-hidden="true"></i>{dirty ? "Unsaved changes" : hasSavedDocument ? "Saved locally" : "Not saved"}</span>
  </div>
  {#if !nodes.length}
    <div class="workflow-empty"><Button onclick={onBrowse}>Add operations from the left menu</Button></div>
  {/if}
  <div class="workflow-message" aria-live="polite">
    {#if error}<p role="alert">{error}</p>{#if retry}<Button size="sm" onclick={() => retry?.()}>Retry</Button>{/if}{:else if notice}<p>{notice}</p>{/if}
  </div>
  <input class="file-input" bind:this={upload} type="file" accept="application/json,.json" aria-label="Import workflow file" onchange={importDocument} />
</section>

<Modal bind:open={descriptionOpen} title="Workflow description" description="Describe what this workflow does." initialFocus={() => descriptionInput}>
  <label class="description-label" for="workflow-description">Description</label>
  <textarea id="workflow-description" bind:this={descriptionInput} bind:value={description} maxlength={workflowDescriptionLimit}
    oninput={() => version = 3} rows={5} placeholder="Explain the purpose of this workflow…"></textarea>
  {#if descriptionError}<p role="alert" class="error">{descriptionError}</p>{/if}
  <div class="modal-actions"><Button onclick={saveDescription}>{descriptionError ? "Try again" : "Save description"}</Button></div>
</Modal>

<Modal bind:open={runOpen} title={`Run workflow: ${runDocument?.name ?? name}`} description="Review each step before running it. The operation's catalog determines whether its response is mocked or requested from a live service."
  onCloseAutoFocus={(event) => { event.preventDefault(); void tick().then(focusCanvas); }}>
  {#if runOpen && runDocument}<WorkflowRun document={runDocument} onClose={() => runOpen = false} />{/if}
</Modal>

<Modal bind:open={replacementOpen} title="Unsaved changes" description={`“${name}” has unsaved changes. Save them before replacing this workflow?`} initialFocus={() => cancelReplacement} onCloseAutoFocus={restoreReplacementFocus}>
  {#if replacementError}<p role="alert" class="error">{replacementError}</p>{/if}
  <div class="modal-actions">
    <Button tooltip="Save this workflow before continuing" onclick={() => continueReplacement(true)}>Save and continue</Button>
    <Button variant="outline" tooltip="Continue without saving changes" onclick={() => continueReplacement(false)}>Discard changes</Button>
    <HintButton class="text-button" bind:ref={cancelReplacement} aria-label="Cancel" label="Keep editing this workflow" onclick={() => replacementOpen = false}>Cancel</HintButton>
  </div>
</Modal>

<Modal bind:open={dialogOpen} title="Saved workflows" description="Stored in this browser. Export a copy to keep it elsewhere."
  onCloseAutoFocus={(event) => { if (replacementCompleted) { event.preventDefault(); replacementCompleted = false; } }}
  onEscapeKeydown={(event) => { if (removal) { event.preventDefault(); void cancelRemove(); } }}>
  {#if removal}
    <div class="removal-confirmation" role="group" aria-label="Confirm removal">
      <p>{removal.length === 1 ? `Remove “${removal[0]!.name}” from this browser?` : `Remove ${removal.length} saved workflows from this browser?`}</p>
      {#if removalError}<p role="alert" class="error">{removalError}</p>{/if}
      <div class="modal-actions"><Button variant="outline" tooltip="Remove the selected saved workflows from this browser" onclick={removeDocuments}>{removalError ? "Try again" : "Remove"}</Button>
        <HintButton class="text-button" bind:ref={cancelRemoval} aria-label="Cancel" label="Keep this saved workflow" onclick={cancelRemove}>Cancel</HintButton></div>
    </div>
  {:else}
  {#if libraryError}<p role="alert" class="error">{libraryError}</p><Button onclick={() => refreshDocuments()}>Retry</Button>{/if}
  {#if documents.length}
    <div class="document-selection"><span>{selectedDocuments.length} selected</span><Button size="sm" disabled={!selectedDocuments.length}
      onclick={() => confirmRemoval(documents.filter(document => selectedDocuments.includes(document.id)))}>Delete selected workflows</Button></div>
  {/if}
  {#if !documents.length}<p>No saved workflows yet.</p>{/if}
  <ul class="saved-documents">{#each documents as document (document.id)}
    <li data-document-id={document.id}><input type="checkbox" aria-label={`Select ${document.name}`} value={document.id} bind:group={selectedDocuments} />
      <HintButton class="document-entry" aria-label={`${document.name} ${documentSummary(document)}`} label={`Open ${document.name}`} onclick={() => openDocument(document)}><strong>{document.name}</strong><span>{documentSummary(document)}</span></HintButton>
      <Button variant="ghost" size="sm" aria-label={`Remove ${document.name}`} tooltip={`Remove ${document.name} from saved workflows`} onclick={() => confirmRemoval([document])}>Remove</Button></li>
  {/each}</ul>
  {/if}
</Modal>

<style>
  .workflow-workspace { position: relative; width: 100%; height: 100%; min-height: 0; container: workflow-canvas / inline-size; }
  .document-meta { position: absolute; z-index: 5; top: calc(var(--workflow-toolbar-height, 36px) + 1.5rem); right: 1rem; display: grid; justify-items: end; gap: 4px; width: var(--workflow-toolbar-width, 350px); max-width: calc(100% - 2rem); padding: 4px; background: color-mix(in srgb, var(--color-background) 75%, transparent); }
  .document-meta input { width: 100%; min-width: 0; height: 26px; border: 0; border-bottom: 1px solid transparent; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 650; text-align: right; text-overflow: ellipsis; }
  .document-meta input:hover { border-bottom-color: var(--color-border); }
  .document-meta input:focus { border-bottom-color: var(--color-accent); outline: none; }
  .document-meta span { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--color-muted-foreground); }
  .document-meta i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-foreground); }
  .document-meta .unsaved i { background: var(--color-accent); }
  .document-meta .fresh i { background: transparent; }
  .workflow-empty { position: absolute; inset: 0; padding: 1rem; align-content: center; display: grid; justify-items: center; text-align: center; pointer-events: none; }
  .workflow-empty :global(button) { pointer-events: auto; max-width: 100%; height: auto; min-height: 36px; white-space: normal; font-weight: 700; }
  .workflow-message { position: absolute; left: 1rem; bottom: 2.5rem; z-index: 6; max-width: min(500px, calc(100% - 2rem)); font-size: 12px; overflow-wrap: anywhere; }
  .workflow-message p { padding: 10px; border-radius: 4px; background: var(--color-surface); }
  .populated .workflow-message { max-width: min(500px, calc(100% - 228px)); }
  @container workflow-canvas (width < 480px) { .populated .workflow-message { max-width: calc(100% - 168px); } }
  .workflow-message [role="alert"] { color: var(--color-error-foreground); background: var(--color-error-background); border-left: 3px solid currentColor; }
  .file-input { display: none; }
  .description-label { display: block; margin-bottom: 8px; font-weight: 700; }
  #workflow-description { display: block; width: 100%; padding: 12px; border: 0; border-radius: 4px; resize: vertical; background: var(--color-foreground); color: var(--color-background); }
  #workflow-description::placeholder { color: var(--color-surface); }
  .document-selection { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .document-selection span { color: var(--color-muted-foreground); font-size: 12px; }
  .saved-documents input[type="checkbox"] { flex-shrink: 0; width: 18px; height: 18px; accent-color: var(--color-emphasis); }
  .saved-documents li { position: relative; transition: transform 180ms ease-in; }
  .saved-documents :global(.document-entry:is(:hover,:focus-visible)) { background: var(--color-chip-hover); color: var(--color-chip-hover-foreground); }
  .saved-documents :global(.document-entry:is(:hover,:focus-visible) span) { color: inherit; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .saved-documents li:has(:global(.document-entry:enabled)):not([inert] *) { will-change: transform; }
    .saved-documents li:has(:global(.document-entry:is(:hover,:focus-visible))) { z-index: 1; transform: scale(min(1.10, var(--hover-scale, 1.10))); }
    .saved-documents :global(.document-entry:is(:hover,:focus-visible)) { transform: none; }
  }
  :global(.workflow-workspace .svelte-flow) { --xy-edge-stroke-default: var(--color-graph-line); --xy-edge-stroke-width: 2; --xy-edge-stroke-selected-default: var(--color-emphasis); --xy-connectionline-stroke-default: var(--color-emphasis); --xy-connectionline-stroke-width: 2; --xy-background-pattern-dots-color-default: color-mix(in srgb, var(--color-foreground) 13%, transparent); --xy-background-color-default: transparent; --xy-selection-background-color: color-mix(in srgb, var(--color-accent) 8%, transparent); --xy-selection-border: 1px dashed var(--color-accent); background: transparent; }
  /* Focusable node wrappers move via transform; never ease their drag positions. */
  :global(.workflow-workspace .svelte-flow__node) { transition: outline-color 180ms ease-in; }
  :global(.workflow-workspace .svelte-flow__arrowhead polyline) { stroke: context-stroke; }
  :global(.workflow-workspace .svelte-flow__arrowhead polyline.arrowclosed) { fill: context-stroke; }
  :global(.workflow-workspace .svelte-flow__edge-path) { transition: stroke 120ms ease-in, stroke-width 120ms ease-in; }
  :global(.workflow-workspace .svelte-flow__edge:hover .svelte-flow__edge-path) { stroke-width: 3px; }
</style>
