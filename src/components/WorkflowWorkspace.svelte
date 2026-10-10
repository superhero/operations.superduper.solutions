<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { onMount, setContext, tick, untrack } from "svelte";
  import { Background, BackgroundVariant, ConnectionLineType, MarkerType, SvelteFlow, addEdge, type Edge, type Node, type Connection } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { Button } from "$lib/components/ui/button/index.js";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import type { Operation } from "$lib/catalog.ts";
  import { parseWorkflowDocument, validateWorkflowDocument, maxWorkflowFileSize, type WorkflowDocument, type WorkflowDocumentNode, type WorkflowDocumentEdge, type SwitchGate, type CastData } from "$lib/workflow-document.ts";
  import { workflowRepository, type WorkflowRepositoryState, type WorkflowRevision } from "$lib/workflow-repository.ts";
  import type { WorkflowDefaults } from "$lib/app-settings.ts";
  import type { WorkflowSaveStatus } from "$lib/workspace.d.ts";
  import WorkflowHistory from "./workflows/WorkflowHistory.svelte";
  import { createOperationGraph, createUtilityNode, createWorkflowGraph, addSwitchGate, updateSwitchGate, removeSwitchGate, schemaBranches, isWorkflowConnection, removeGraphSelection, restoreDataBranch } from "$lib/workflow-graph.ts";
  import { adaptRoutingGates, routingInputTypes, workflowDescriptionLimit } from "$lib/workflow-utilities.ts";
  import { getOperationReport } from "$lib/operation-report.ts";
  import WorkflowNode from "../WorkflowNode.svelte";
  import WorkflowToolbar from "./workflows/WorkflowToolbar.svelte";
  import WorkflowMinimap from "./workflows/WorkflowMinimap.svelte";
  import WorkflowDataNode from "./workflows/WorkflowDataNode.svelte";
  import WorkflowConnectionSnap from "./workflows/WorkflowConnectionSnap.svelte";
  import WorkflowSelection from "./workflows/WorkflowSelection.svelte";
  import WorkflowSwitchNode from "./workflows/WorkflowSwitchNode.svelte";
  import WorkflowCastNode from "./workflows/WorkflowCastNode.svelte";
  import WorkflowCommentNode from "./workflows/WorkflowCommentNode.svelte";
  import WorkflowReferenceNode from "./workflows/WorkflowReferenceNode.svelte";
  import WorkflowRun from "./workflows/WorkflowRun.svelte";
  import Modal from "$lib/components/Modal.svelte";

  let { active, navigationOpen = false, navigationModal = false, documentModal = $bindable(false), saveStatus = $bindable<WorkflowSaveStatus>("loading"), documents = $bindable([]), libraryError = $bindable(""), workflowDefaults, onBrowse }:
    { active: boolean; navigationOpen?: boolean; navigationModal?: boolean; documentModal?: boolean; saveStatus?: WorkflowSaveStatus; documents?: WorkflowDocument[]; libraryError?: string; workflowDefaults: WorkflowDefaults; onBrowse: () => void } = $props();
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
  const initialWorkflowDefaults = untrack(() => workflowDefaults);
  let snap = $state(initialWorkflowDefaults.snap);
  let curved = $state(initialWorkflowDefaults.curved);
  let dashed = $state(initialWorkflowDefaults.dashed);
  const gridSize = $derived(workflowDefaults.gridSize);
  let savedSnapshot = $state("");
  let hasSavedDocument = $state(false);
  let storageReady = $state(false);
  let saveError = $state("");
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let persistedRevision = $state<string | null>(null);
  let saving = $state(false);
  let actionBusy = $state(false);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let historyOpen = $state(false);
  let historyLoading = $state(false);
  let historyError = $state("");
  let revisions = $state<WorkflowRevision[]>([]);
  let savePromise: Promise<boolean> | null = null;
  let queuedSnapshot: string | null = null;
  let textEditing = $state(false);
  let placement = $state.raw<Promise<void> | null>(null);
  let movementAnnouncement = $state("");
  let textEditTarget: EventTarget | null = null;
  let initialDraft: WorkflowDocument | null = null;
  let alive = true;
  let refreshGeneration = 0;
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
  let runOpen = $state(false);
  let runDocument = $state<WorkflowDocument | null>(null);
  let pendingAction = $state<((didSave: boolean) => void | Promise<void>) | null>(null);
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
  let replacementOrigin: HTMLElement | null = null;
  let revision = $state(0);
  const selected = $derived(nodes.some(node => node.selected) || edges.some(edge => edge.selected));
  const graphBlocked = $derived(!active || !storageReady || actionBusy || navigationModal || dialogOpen || replacementOpen || descriptionOpen || runOpen || historyOpen);
  const keyboardActive = $derived(!graphBlocked);
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
  $effect(() => { documentModal = actionBusy || dialogOpen || replacementOpen || descriptionOpen || runOpen || historyOpen; });
  $effect(() => { if (dirty) notice = ""; });
  $effect(() => {
    saveStatus = !storageReady ? "loading" : dirty || saving ? saveError ? "error" : "saving" : hasSavedDocument ? "saved" : "unsaved";
  });
  $effect(() => {
    const defaults = workflowDefaults;
    const ready = storageReady;
    untrack(() => {
      // An untouched initial canvas should use Settings even before New is pressed.
      if (!ready || hasSavedDocument || dirty || saving || !initialDraft) return;
      snap = defaults.snap;
      curved = defaults.curved;
      dashed = defaults.dashed;
      savedSnapshot = JSON.stringify(documentValue());
      initialDraft = JSON.parse(savedSnapshot);
    });
  });
  $effect(() => {
    const value = snapshot;
    const editing = textEditing || placement !== null || nodes.some(node => node.dragging);
    if (!storageReady) return;
    untrack(() => {
      cancelAutosave();
      const previous = queuedSnapshot ?? savedSnapshot;
      if (value === previous || editing) return;
      if (versionedSnapshot(value) === versionedSnapshot(previous))
        autosaveTimer = setTimeout(() => { void save(false, value); }, 300);
      else void save(false, value);
    });
    return cancelAutosave;
  });
  $effect(() => { if (!active) untrack(flushAutosave); });
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

  function snapNodeCenter(node: GraphNode): GraphNode {
    const width = node.measured?.width ?? node.width;
    const height = node.measured?.height ?? node.height;
    if (width === undefined || height === undefined) return node;
    return { ...node, position: {
      x: Math.round((node.position.x + width / 2) / gridSize) * gridSize - width / 2,
      y: Math.round((node.position.y + height / 2) / gridSize) * gridSize - height / 2
    } };
  }

  function updateCanvasNodes(updated: GraphNode[]) {
    if (!snap) { nodes = updated; return; }
    const previous = new Map(nodes.map(node => [node.id, node]));
    nodes = updated.map(node => {
      const before = previous.get(node.id);
      // Keep load, measurement and selection updates at their saved positions.
      if (!before || node.position.x === before.position.x && node.position.y === before.position.y) return node;
      return snapNodeCenter(node);
    });
  }

  function moveSnappedNodes(event: KeyboardEvent) {
    if (!snap || !keyboardActive || !(event.target instanceof HTMLElement) ||
      event.target.closest("input, textarea, select, [contenteditable], .nokey")) return;
    const target = event.target.closest<HTMLElement>(".svelte-flow__node, .svelte-flow__selection-wrapper");
    if (!target) return;
    if (target.matches(".svelte-flow__node") && !nodes.some(node => node.id === target.dataset.id && node.selected && node.draggable !== false)) return;
    const directions: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const step = gridSize * (event.shiftKey ? 4 : 1);
    nodes = nodes.map(node => node.selected && node.draggable !== false && !node.hidden
      ? snapNodeCenter({ ...node, position: { x: node.position.x + direction[0] * step, y: node.position.y + direction[1] * step } })
      : node);
    const moved = nodes.find(node => node.selected && node.draggable !== false && !node.hidden);
    if (moved) movementAnnouncement = `Moved ${event.key.slice(5).toLowerCase()}. Position ${Math.round(moved.position.x)}, ${Math.round(moved.position.y)}.`;
  }

  function selectNodeBranch(event: MouseEvent) {
    if (!keyboardActive || event.shiftKey || !(event.target instanceof Element) ||
      event.target.closest("button, a, input, textarea, select, [contenteditable], .nokey, .svelte-flow__handle")) return;
    const wrapper = event.target.closest<HTMLElement>(".svelte-flow__node");
    const clicked = nodes.find(node => node.id === wrapper?.dataset.id);
    if (!clicked || clicked.hidden || clicked.type === "comment") return;
    event.preventDefault();
    event.stopPropagation();
    const direction = clicked.type === "data" ? clicked.data.direction : null;
    const visible = new Set(nodes.filter(node => !node.hidden).map(node => node.id));
    const selection = new Set([clicked.id]);
    // Schema branches follow inputs upstream and outputs downstream, without
    // crossing user mappings to nodes on the opposite side of an operation.
    for (const id of selection) for (const branch of branches.get(id)?.values() ?? []) {
      if (!branch.hidden && visible.has(branch.childId) && (!direction || branch.direction === direction))
        selection.add(branch.childId);
    }
    nodes = nodes.map(node => ({ ...node, selected: selection.has(node.id) }));
    edges = edges.map(edge => edge.selected ? { ...edge, selected: false } : edge);
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
    cancelAutosave();
    textEditing = false;
    textEditTarget = null;
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
    persistedRevision = null;
    initialDraft = !stored && saved ? JSON.parse(snapshot) : null;
    canUndo = canRedo = false;
    saveError = "";
    revision += 1;
    error = notice = ""; retry = null;
    // Let replacement release its busy state before the dialog focuses Name.
    if (focus) void tick().then(() => requestAnimationFrame(() => {
      if (!active) return;
      if (focus === "name") describeWorkflow();
      else focusCanvas();
    }));
  }

  function hydrateSaved(state: WorkflowRepositoryState, focus: "name" | "canvas" | null = null) {
    hydrate(state.document, true, true, focus);
    persistedRevision = state.revision;
    canUndo = state.canUndo;
    canRedo = state.canRedo;
  }

  onMount(() => {
    savedSnapshot = JSON.stringify(documentValue());
    initialDraft = JSON.parse(savedSnapshot);
    void refreshDocuments(true);
    const unsubscribe = workflowRepository.subscribe(() => { if (storageReady) void refreshDocuments(); });
    const hidden = () => { if (window.document.visibilityState === "hidden") void flushAutosave(); };
    const pageHidden = () => { void flushAutosave(); };
    const input = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (!canvas?.contains(target) && target.id !== "workflow-name" && target.id !== "workflow-description") return;
      textEditTarget = target;
      textEditing = true;
    };
    const blur = (event: FocusEvent) => {
      if (event.target === textEditTarget) { textEditTarget = null; textEditing = false; }
    };
    window.addEventListener("pagehide", pageHidden);
    window.document.addEventListener("visibilitychange", hidden);
    window.document.addEventListener("input", input, true);
    window.document.addEventListener("focusout", blur, true);
    return () => {
      alive = false;
      void flushAutosave();
      unsubscribe();
      window.removeEventListener("pagehide", pageHidden);
      window.document.removeEventListener("visibilitychange", hidden);
      window.document.removeEventListener("input", input, true);
      window.document.removeEventListener("focusout", blur, true);
    };
  });

  export async function refreshDocuments(restoreLatest = !storageReady): Promise<boolean> {
    const generation = ++refreshGeneration;
    try {
      await workflowRepository.initialize();
      const loaded = await workflowRepository.list();
      if (!alive || generation !== refreshGeneration) return false;
      documents = loaded;
      selectedDocuments = selectedDocuments.filter(id => documents.some(document => document.id === id));
      libraryError = "";
      if (restoreLatest && !nodes.length && !dirty) {
        const latest = documents.at(-1);
        if (latest) {
          const state = await workflowRepository.load(latest.id);
          if (!alive || generation !== refreshGeneration) return false;
          hydrateSaved(state);
        }
      }
      storageReady = true;
      return true;
    } catch (failure) {
      if (!alive || generation !== refreshGeneration) return false;
      libraryError = `Could not load saved workflows: ${failure instanceof Error ? failure.message : String(failure)}`;
      return false;
    }
  }

  const insertionPosition = () => ({ x: (180 - viewport.x) / viewport.zoom, y: (180 - viewport.y) / viewport.zoom });

  async function appendGraph(graph: Pick<WorkflowDocument, "nodes" | "edges">, nodeId: string, title: string, requiredVersion: 2 | 3) {
    if (placement) await placement;
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
    const addedIds = new Set(graph.nodes.map(node => node.id));
    // Measure the rendered nodes before saving this addition, regardless of drag snapping.
    placement = tick().then(() => {
      const elements = new Map([...canvas?.querySelectorAll<HTMLElement>(".svelte-flow__node") ?? []]
        .map(element => [element.dataset.id, element]));
      nodes = nodes.map(node => {
        const element = elements.get(node.id);
        if (!addedIds.has(node.id) || !element?.offsetWidth || !element.offsetHeight) return node;
        return snapNodeCenter({ ...node, measured: { width: element.offsetWidth, height: element.offsetHeight } });
      });
    }).finally(() => { placement = null; });
    version = Math.max(version, requiredVersion) as 2 | 3;
    nodes = [...nodes.map(node => ({ ...node, selected: false })), ...graph.nodes.map(node => ({ ...graphNode(node), selected: node.id === nodeId }))];
    edges = [...edges.map(edge => ({ ...edge, selected: false })), ...graph.edges.map(paintEdge)];
    error = "";
    notice = "";
    await placement;
    await tick();
    await toolbar?.reveal(graph.nodes.filter(node => !node.hidden).map(node => node.id));
    if (active && !navigationModal) focusCanvas();
  }

  export async function addOperation(operation: Operation) {
    if (!storageReady && !await refreshDocuments()) return;
    if (documentModal || actionBusy) return;
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
    if (!storageReady && !await refreshDocuments()) return;
    if (documentModal || actionBusy) return;
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

  async function saveWorkflowDetails() {
    version = 3;
    if (await flushAutosave()) { descriptionOpen = false; descriptionError = ""; }
    else descriptionError = saveError;
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

  function cancelAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
  }

  function versionedSnapshot(value: string): string {
    if (!value) return "";
    const { viewport: _viewport, snap: _snap, curved: _curved, dashed: _dashed, ...content } = JSON.parse(value);
    return JSON.stringify(content);
  }

  export async function flushPendingChanges(): Promise<boolean> { return flushAutosave(); }

  async function flushAutosave(): Promise<boolean> {
    cancelAutosave();
    if (placement) await placement;
    if (!storageReady) return !dirty && !saving;
    if (savePromise && !await savePromise) return false;
    while (dirty) {
      if (!await save()) return false;
    }
    return true;
  }

  async function save(inConfirmation = false, savingSnapshot = snapshot): Promise<boolean> {
    cancelAutosave();
    if (!storageReady) return false;
    if (savePromise && queuedSnapshot === savingSnapshot) return savePromise;
    if (!savePromise && savingSnapshot === savedSnapshot) return true;
    const savingId = id;
    const value: WorkflowDocument = JSON.parse(savingSnapshot);
    const previousSave = savePromise;
    queuedSnapshot = savingSnapshot;
    saving = true;
    const operation = (async () => {
      try {
        // Capture each completed edit before waiting, so fast actions cannot overwrite it.
        if (previousSave && !await previousSave) return false;
        if (id !== savingId) return false;
        if (savingSnapshot === savedSnapshot) return true;
        let expectedRevision = persistedRevision;
        if (expectedRevision === null && initialDraft?.id === savingId) {
          const baseline = await workflowRepository.save(initialDraft, null, "Create workflow");
          expectedRevision = baseline.revision;
          if (id === savingId) persistedRevision = baseline.revision;
          initialDraft = null;
        }
        const state = await workflowRepository.save(value, expectedRevision);
        if (id === savingId) {
          persistedRevision = state.revision;
          savedSnapshot = savingSnapshot;
          hasSavedDocument = true;
          canUndo = state.canUndo;
          canRedo = state.canRedo;
          saveError = "";
        }
        return true;
      } catch (failure) {
        if (id === savingId) {
          saveError = `Could not save “${value.name}”: ${failure instanceof Error ? failure.message : String(failure)}`;
          if (inConfirmation) replacementError = saveError;
        }
        return false;
      }
    })();
    savePromise = operation;
    try { return await operation; }
    finally {
      if (savePromise === operation) { saving = false; savePromise = null; queuedSnapshot = null; }
    }
  }

  async function replace(action: (didSave: boolean) => void | Promise<void>, returnToCanvas = false) {
    if (actionBusy) return;
    const origin = window.document.activeElement;
    const hadChanges = dirty || saving;
    actionBusy = true;
    try {
      if (!await flushAutosave()) {
        replacementOrigin = origin instanceof HTMLElement ? origin : null;
        pendingAction = action;
        replacementReturnToCanvas = returnToCanvas;
        replacementError = saveError || libraryError;
        replacementOpen = true;
      } else await action(hadChanges);
    } catch (failure) { describeFailure("Could not open workflow", failure); }
    finally { actionBusy = false; }
  }

  function newDocument() {
    intent += 1;
    void replace(() => hydrate({ version: 1, id: crypto.randomUUID(), name: "Untitled workflow", nodes: [], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }, dashed: workflowDefaults.dashed, curved: workflowDefaults.curved,
      snap: workflowDefaults.snap }, true, false, "name"));
  }

  function openDocuments() {
    intent += 1;
    void refreshDocuments();
    removal = null; removalError = ""; selectedDocuments = []; dialogOpen = true;
  }

  function openDocument(document: WorkflowDocument) {
    intent += 1;
    replacementCompleted = true;
    dialogOpen = false;
    void replace(async () => hydrateSaved(await workflowRepository.load(document.id), "canvas"), true);
  }

  async function removeDocuments() {
    if (!removal || actionBusy) return;
    const requested = removal;
    actionBusy = true;
    cancelAutosave();
    try {
      if (savePromise) await savePromise;
      if (!requested.some(document => document.id === id) && !await flushAutosave())
        throw new Error(saveError || "The current workflow could not be saved.");
      await workflowRepository.remove(requested.map(document => document.id));
      if (requested.some(document => document.id === id)) {
        cancelAutosave();
        id = crypto.randomUUID();
        savedSnapshot = snapshot;
        initialDraft = JSON.parse(snapshot);
        hasSavedDocument = false;
        persistedRevision = null;
        canUndo = canRedo = false;
        saveError = "";
      }
      await refreshDocuments();
      selectedDocuments = selectedDocuments.filter(id => documents.some(document => document.id === id));
      removal = null;
      removalError = "";
      await tick();
      window.document.querySelector<HTMLElement>(".document-entry, .modal-close")?.focus();
    } catch (failure) { removalError = `Could not remove ${requested.length === 1 ? `“${requested[0]!.name}”` : `${requested.length} saved workflows`}: ${failure instanceof Error ? failure.message : String(failure)}`; }
    finally {
      actionBusy = false;
      if (dirty && !saveError) autosaveTimer = setTimeout(() => { void save(); }, 300);
    }
  }

  async function openHistory() {
    if (actionBusy || !storageReady) return;
    historyOpen = true;
    historyLoading = true;
    historyError = "";
    try {
      if (!await flushAutosave()) throw new Error(saveError || "The latest changes could not be saved.");
      revisions = hasSavedDocument ? await workflowRepository.history(id) : [];
    } catch (failure) { historyError = failure instanceof Error ? failure.message : String(failure); }
    finally { historyLoading = false; }
  }

  async function changeVersion(action: "undo" | "redo" | "restore", oid?: string) {
    if (actionBusy || !storageReady) return;
    actionBusy = true;
    historyError = "";
    try {
      if (!await flushAutosave() || !persistedRevision) throw new Error(saveError || "Save this workflow before changing versions.");
      const state = action === "restore"
        ? await workflowRepository.restore(id, oid!, persistedRevision)
        : await workflowRepository[action](id, persistedRevision);
      hydrateSaved(state);
      await refreshDocuments();
      if (historyOpen) revisions = await workflowRepository.history(id);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (historyOpen) historyError = message;
      else { error = message; retry = () => { void changeVersion(action, oid); }; }
    } finally { actionBusy = false; }
  }

  function historyShortcut(event: KeyboardEvent) {
    if (!keyboardActive || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const undo = event.key.toLowerCase() === "z" && !event.shiftKey;
    const redo = (event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y";
    if (undo || redo) {
      event.preventDefault();
      if (undo ? canUndo || dirty : canRedo && !dirty) void changeVersion(undo ? "undo" : "redo");
    }
  }

  function exportDocument() {
    try {
      const document = validateWorkflowDocument(documentValue());
      const file = new Blob([JSON.stringify(document)], { type: "application/json" });
      if (file.size > maxWorkflowFileSize) throw new Error("Workflow documents must be smaller than 2 MB. Reduce this plan before exporting it.");
      const url = URL.createObjectURL(file);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${document.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "workflow"}.json`;
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
      await replace(() => hydrate(document, false, false, "canvas"));
    } catch (failure) { if (generation === intent) describeFailure(`Could not import “${file.name}”`, failure); }
  }

  async function continueReplacement(shouldSave: boolean) {
    if (actionBusy) return;
    actionBusy = true;
    if (shouldSave && !await flushAutosave()) { replacementError = saveError; actionBusy = false; return; }
    cancelAutosave();
    const action = pendingAction;
    pendingAction = null;
    replacementCompleted = true;
    replacementOpen = false;
    replacementError = "";
    try { await action?.(shouldSave); }
    catch (failure) { describeFailure("Could not open workflow", failure); }
    finally { actionBusy = false; }
  }

  function restoreReplacementFocus(event: Event) {
    if (replacementCompleted || replacementReturnToCanvas || replacementOrigin) event.preventDefault();
    if (!replacementCompleted) {
      const target = replacementOrigin;
      void tick().then(() => requestAnimationFrame(() => {
        if (target?.isConnected && !target.closest("[inert]")) target.focus({ preventScroll: true });
        else focusCanvas();
      }));
    }
    replacementOrigin = null;
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
    // IndexedDB/Git writes are asynchronous: never claim a pending save is durable
    // during unload. Ask the browser to keep the page open until it completes.
    if (storageReady && (dirty || saving)) {
      void flushAutosave();
      event.preventDefault(); event.returnValue = "";
    }
  }

  function documentSummary(document: WorkflowDocument): string {
    const nested = document.nodes.filter(node => node.type === "workflow").length;
    return `${document.nodes.filter(node => !node.type || node.type === "operation").length} operations${nested ? ` · ${nested} workflows` : ""} · ${document.edges.filter(edge => edge.kind !== "schema").length} connections`;
  }
</script>

<svelte:window onbeforeunload={beforeUnload} onkeydown={historyShortcut} />

<section class="workflow-workspace" class:populated={nodes.length > 0} tabindex="-1" aria-label="Workflow canvas" inert={graphBlocked} bind:this={canvas} onkeydowncapture={moveSnappedNodes} ondblclickcapture={selectNodeBranch}>
  <span class="sr-only" aria-live="assertive" aria-atomic="true">{movementAnnouncement}</span>
  {#if activated}
  {#key revision}
    <SvelteFlow bind:nodes={() => nodes, updateCanvasNodes} bind:edges bind:viewport {nodeTypes} defaultEdgeOptions={edgeOptions} connectionLineType={curved ? ConnectionLineType.Bezier : ConnectionLineType.SmoothStep} onbeforeconnect={prepareConnection} onconnect={adaptGates}
      defaultMarkerColor={null} connectionLineStyle={`marker-end: url(#${connectionMarkerId})`}
      minZoom={0.25} maxZoom={2} {...(snap ? {} : { snapGrid: [1, 1] as [number, number] })}
      deleteKey={keyboardActive ? ["Backspace", "Delete"] : null} selectionKey={keyboardActive ? "Shift" : null}
      multiSelectionKey={keyboardActive ? ["Shift", "Meta", "Control"] : null} panActivationKey={keyboardActive ? " " : null}
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
      <WorkflowSelection {canvas} active={keyboardActive} />
      <WorkflowConnectionSnap bind:this={connectionSnap} isValidConnection={validConnection} active={keyboardActive} {curved} {dashed} markerEnd={`url(#${connectionMarkerId})`} />
      {#if nodes.length}<WorkflowMinimap active={keyboardActive} />{/if}
      <WorkflowToolbar bind:this={toolbar} {canvas} {active} {navigationOpen} {snap} {curved} {dashed} {selected}
        onsnap={() => snap = !snap} oncurved={switchCurve} ondashed={switchDashes}
        onremove={removeSelected} onnew={newDocument} onopen={openDocuments}
        onexport={exportDocument} onimport={() => upload.click()} onbrowse={onBrowse}
        onutility={addUtility} ondescribe={describeWorkflow} onrun={() => startRun()}
        canUndo={canUndo || (hasSavedDocument && dirty)} canRedo={canRedo && !dirty} historyBusy={actionBusy || saving}
        onundo={() => changeVersion("undo")} onredo={() => changeVersion("redo")} onhistory={openHistory} />
    </SvelteFlow>
  {/key}
  {/if}
  {#if !nodes.length}
    <div class="workflow-empty"><Button onclick={onBrowse}><span>Add nodes<br />by selecting workflow operations<br />from the left menu</span></Button></div>
  {/if}
  <div class="workflow-message" aria-live="polite">
    {#if saveError}<p role="alert">{saveError}</p><Button size="sm" onclick={() => save()}>Retry saving</Button>{/if}
    {#if error}<p role="alert">{error}</p>{#if retry}<Button size="sm" onclick={() => retry?.()}>Retry</Button>{/if}{:else if notice}<p>{notice}</p>{/if}
  </div>
  <input class="file-input" bind:this={upload} type="file" accept="application/json,.json" aria-label="Import workflow file" onchange={importDocument} />
</section>

{#if !storageReady && libraryError}
  <div class="workflow-load-error" role="alert"><p>{libraryError}</p><Button onclick={() => refreshDocuments(true)}>Retry</Button></div>
{/if}

<Modal bind:open={historyOpen} title="Workflow history"
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    void tick().then(() => requestAnimationFrame(() => {
      if (active && !navigationModal) canvas?.querySelector<HTMLElement>('button[aria-label="Workflow history"]')?.focus({ preventScroll: true });
    }));
  }}>
  {#if historyError}<p role="alert" class="error">{historyError}</p><Button onclick={openHistory}>Retry</Button>{/if}
  {#if historyLoading}<p role="status">Loading history…</p>
  {:else if historyOpen}<WorkflowHistory workflowId={id} {revisions} currentRevision={persistedRevision} busy={actionBusy} onrestore={(oid) => changeVersion("restore", oid)} />{/if}
</Modal>

<Modal bind:open={descriptionOpen} title="Workflow details" initialFocus={() => nameInput}>
  <div class="workflow-name-field">
    <label class="description-label" for="workflow-name">Name</label>
    <input id="workflow-name" bind:this={nameInput} aria-label="Workflow name" maxlength={100} bind:value={name} disabled={actionBusy || !storageReady} />
  </div>
  <label class="description-label" for="workflow-description">Description</label>
  <textarea id="workflow-description" bind:value={description} maxlength={workflowDescriptionLimit}
    oninput={() => version = 3} rows={5} placeholder="Explain the purpose of this workflow…"></textarea>
  {#if descriptionError}<p role="alert" class="error">{descriptionError}</p>{/if}
  <div class="modal-actions" style:justify-content="flex-end"><Button size="icon" aria-label={descriptionError ? "Try again" : "Save workflow details"}
    tooltip={descriptionError ? "Try again" : "Save workflow details"} onclick={saveWorkflowDetails}><MaterialIcon name="save" size={20} /></Button></div>
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
  .workflow-load-error { padding: 20px; color: var(--color-error-foreground); background: var(--color-error-background); }
  .workflow-workspace { position: relative; width: 100%; height: 100%; min-height: 0; container: workflow-canvas / inline-size; }
  .workflow-empty { position: absolute; inset: 0; padding: 1rem; align-content: center; display: grid; justify-items: center; text-align: center; pointer-events: none; }
  .workflow-empty :global(button) { pointer-events: auto; max-width: 100%; height: auto; min-height: 36px; white-space: normal; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .workflow-message { position: absolute; left: 1rem; bottom: 2.5rem; z-index: 6; max-width: min(500px, calc(100% - 2rem)); font-size: 12px; overflow-wrap: anywhere; }
  .workflow-message p { padding: 10px; border-radius: 4px; background: var(--color-surface); }
  .populated .workflow-message { max-width: min(500px, calc(100% - 228px)); }
  @container workflow-canvas (width < 480px) { .populated .workflow-message { max-width: calc(100% - 168px); } }
  .workflow-message [role="alert"] { color: var(--color-error-foreground); background: var(--color-error-background); border-left: 3px solid currentColor; }
  .file-input { display: none; }
  .description-label { display: block; margin-bottom: 8px; font-weight: 700; }
  .workflow-name-field { margin-bottom: 16px; }
  #workflow-name, #workflow-description { display: block; width: 100%; padding: 12px; border: 0; border-radius: 4px; background: var(--color-foreground); color: var(--color-background); }
  #workflow-description { resize: vertical; }
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
  /* Node contents provide focus feedback; wrapper outlines flash on blur. */
  .workflow-workspace,
  :global(.workflow-workspace :is(.svelte-flow, .svelte-flow__renderer, .svelte-flow__pane, .svelte-flow__background)) { outline: none; }
  :global(.workflow-workspace .svelte-flow__node) { outline: none; transition: none; }
  /* Remove inactive outlines immediately instead of fading from currentColor. */
  :global(.workflow-workspace:not(:focus-visible)),
  :global(.workflow-workspace :where(button, a[href], summary, input, select, textarea, [tabindex]):not(:focus-visible)) { outline-style: none; }
  :global(.workflow-workspace .svelte-flow__arrowhead polyline) { stroke: context-stroke; }
  :global(.workflow-workspace .svelte-flow__arrowhead polyline.arrowclosed) { fill: context-stroke; }
  :global(.workflow-workspace .svelte-flow__edge-path) { transition: stroke 120ms ease-in, stroke-width 120ms ease-in; }
  :global(.workflow-workspace .svelte-flow__edge:hover .svelte-flow__edge-path) { stroke-width: 3px; }
</style>
