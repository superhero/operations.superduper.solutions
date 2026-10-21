<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { defaultToolbarButtons, type ToolbarButtons } from "$lib/toolbar-settings.ts";
  import { copyWorkflowSelection, pasteWorkflowSelection, type WorkflowClipboard } from "$lib/workflow-clipboard.ts";
  import { defaultKeybindings, shortcutAction, modifierKeys, modifierPressed, type Keybindings } from "$lib/keybindings.ts";
  import { onDestroy, onMount, setContext, tick, untrack } from "svelte";
  import { Background, BackgroundVariant, ConnectionLineType, MarkerType, SvelteFlow, SvelteFlowProvider, addEdge, type Edge, type Node, type Connection } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { Button } from "$lib/components/ui/button/index.js";
  import HintButton from "$lib/components/HintButton.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { pinOperationModels, type Operation } from "$lib/catalog.ts";
  import { catalogForOperation } from "$lib/catalog-registry.ts";
  import { createWorkflowSchemaLease, hydrateOperation, getSchemaLibrary } from "$lib/schema-library.ts";
  import { workflowOperationIds } from "$lib/schema-models.ts";
  import { operationNavigation } from "$lib/operation-navigation.ts";
  import { updateOperationVersion } from "$lib/workflow-operation-version.ts";
  import { portableWorkflowDocument, parseWorkflowDocument, validateWorkflowDocument, maxWorkflowFileSize, type WorkflowDocument, type WorkflowDocumentNode, type WorkflowDocumentEdge, type WorkflowField, type SwitchGate, type CastData } from "$lib/workflow-document.ts";
  import { workflowRepository } from "$lib/workflow-repository-client.ts";
  import type { WorkflowRepositoryState, WorkflowRevision } from "$lib/workflow-repository.ts";
  import { finishStartup, reportStartup } from "$lib/startup-progress.ts";
  import type { WorkflowDefaults } from "$lib/app-settings.ts";
  import type { WorkflowSaveStatus } from "$lib/workspace.d.ts";
  import WorkflowHistory from "./workflows/WorkflowHistory.svelte";
  import { updateFileDataGraph, createOperationGraph, createUtilityNode, createWorkflowGraph, addAdditionalProperty, getAdditionalPropertyTypes, getEditableAdditionalProperties, updateAdditionalProperty, removeAdditionalProperty, addSwitchGate, updateSwitchGate, removeSwitchGate, schemaBranches, isWorkflowConnection, removeGraphSelection, restoreDataBranch } from "$lib/workflow-graph.ts";
  import { layoutAddedGraph, placeUtilityNode } from "$lib/workflow-layout.ts";
  import { insertFileBinaryCast, canAddArrayFilterAssertion, addArrayFilterAssertion } from "$lib/workflow-graph.ts";
  import { orderWorkflowNodes, restoreWorkflowNodeOrder } from "$lib/workflow-focus-order.ts";
  import { adaptRoutingGates, routingInputTypes, workflowDescriptionLimit, workflowInputConnected } from "$lib/workflow-utilities.ts";
  import { getOperationReport } from "$lib/operation-report.ts";
  import WorkflowNode from "../WorkflowNode.svelte";
  import WorkflowToolbar from "./workflows/WorkflowToolbar.svelte";
  import WorkflowMinimap from "./workflows/WorkflowMinimap.svelte";
  import WorkflowDataNode from "./workflows/WorkflowDataNode.svelte";
  import WorkflowConnectionSnap from "./workflows/WorkflowConnectionSnap.svelte";
  import WorkflowCurveEdge from "./workflows/WorkflowCurveEdge.svelte";
  import WorkflowConnectionLine from "./workflows/WorkflowConnectionLine.svelte";
  import RoutingScope from "$lib/flow-routing/RoutingScope.svelte";
  import RoutedEdge from "$lib/flow-routing/RoutedEdge.svelte";
  import { createWorkflowRoutingClient } from "$lib/workflow-routing-client.ts";
  import { logger } from "$lib/logger.ts";
  import WorkflowSelection from "./workflows/WorkflowSelection.svelte";
  import WorkflowSwitchNode from "./workflows/WorkflowSwitchNode.svelte";
  import WorkflowFileNode from "./workflows/WorkflowFileNode.svelte";
  import type { WorkflowFileData } from "$lib/workflow-file.ts";
  import WorkflowVaultNode from "./workflows/WorkflowVaultNode.svelte";
  import WorkflowCastNode from "./workflows/WorkflowCastNode.svelte";
  import WorkflowStopNode from "./workflows/WorkflowStopNode.svelte";
  import WorkflowProcessingNode from "./workflows/WorkflowProcessingNode.svelte";
  import type { ProcessingData, ProcessingKind } from "$lib/workflow-processing.ts";
  import { isValueConnection, isWorkflowConnectionTypeCompatible } from "$lib/workflow-utilities.ts";
  import WorkflowCommentNode from "./workflows/WorkflowCommentNode.svelte";
  import WorkflowReferenceNode from "./workflows/WorkflowReferenceNode.svelte";
  import WorkflowRun from "./workflows/WorkflowRun.svelte";
  import type { CredentialBinding } from "$lib/secrets/types.ts";
  import Modal from "$lib/components/Modal.svelte";

  let { toolbarButtons = defaultToolbarButtons, keybindings = defaultKeybindings, active, settingsOpen = false, navigationOpen = false, navigationModal = false, documentModal = $bindable(false), saveStatus = $bindable<WorkflowSaveStatus>("loading"), documents = $bindable([]), libraryError = $bindable(""), workflowDefaults, onBrowse }:
    { toolbarButtons?: ToolbarButtons; keybindings?: Keybindings; active: boolean; settingsOpen?: boolean; navigationOpen?: boolean; navigationModal?: boolean; documentModal?: boolean; saveStatus?: WorkflowSaveStatus; documents?: WorkflowDocument[]; libraryError?: string; workflowDefaults: WorkflowDefaults; onBrowse: () => void } = $props();
  const nodeTypes = { file: WorkflowFileNode, vault: WorkflowVaultNode, operation: WorkflowNode, data: WorkflowDataNode, switch: WorkflowSwitchNode, cast: WorkflowCastNode,
    transform: WorkflowProcessingNode, filter: WorkflowProcessingNode, assert: WorkflowProcessingNode, stop: WorkflowStopNode, comment: WorkflowCommentNode, workflow: WorkflowReferenceNode };
  const edgeTypes = { default: WorkflowCurveEdge, smoothstep: RoutedEdge };
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
  const orderedNodes = $derived(orderWorkflowNodes(nodes, edges));
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
  let saveAttempt = $state.raw<{ snapshot: string; expectedRevision: string | null } | null>(null);
  let queuedSnapshot: string | null = null;
  let textEditing = $state(false);
  let resizingComment = $state(false);
  let placement = $state.raw<Promise<void> | null>(null);
  let movementAnnouncement = $state("");
  let textEditTarget: EventTarget | null = null;
  let initialDraft: WorkflowDocument | null = null;
  let alive = true;
  let refreshGeneration = 0;
  let error = $state("");
  let notice = $state("");
  let clipboard = $state.raw<WorkflowClipboard | null>(null);
  let pasteOffset = 32;
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
  let removal = $state<WorkflowDocument | null>(null);
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
  const schemaLease = createWorkflowSchemaLease();
  const runSchemaLease = createWorkflowSchemaLease();
  const modelIdsKey = $derived([...workflowOperationIds(documentValue())].sort().join("\n"));
  $effect(() => {
    modelIdsKey;
    getSchemaLibrary().revision;
    if (!storageReady) return;
    void untrack(() => schemaLease.update(documentValue())).catch(failure => {
      if (alive) describeFailure("Could not load workflow schemas", failure);
    });
  });
  $effect(() => { if (!runOpen) runSchemaLease.release(); });
  onDestroy(() => { schemaLease.release(); runSchemaLease.release(); });
  const dirty = $derived(snapshot !== savedSnapshot || saveAttempt !== null);
  const dashPeriod = $derived(workflowDefaults.dashLength + workflowDefaults.dashGap);
  const edgeOptions = $derived({ animated: dashed, markerEnd: { type: MarkerType.ArrowClosed }, type: curved ? "default" : "smoothstep", style: dashed ? "stroke-dasharray: var(--workflow-dash-length, 6) var(--workflow-dash-gap, 4)" : "" });
  const branches = $derived(schemaBranches(nodes, edges));
  const inputTypes = $derived(routingInputTypes(nodes, edges));
  const workflowNames = $derived(new Map(documents.map(document => [document.id, document.name])));
  const operationIndex = $derived(operationNavigation(getSchemaLibrary().operations));
  let changingOperationVersion = $state(false);

  setContext("workflow-operation-version", {
    choices: (operationId: string) => (operationIndex.variants.get(operationId) ?? []).map(operation => ({
      value: operation.id, label: operationIndex.paths.get(operation.id)!.version,
      disabled: Boolean(operation.unavailableReason),
    })),
    pending: () => changingOperationVersion,
    active: () => keyboardActive,
    select: changeOperationVersion,
  });

  setContext("workflow-branches", (nodeId: string) => branches.get(nodeId));
  // Reference titles follow live names without changing their embedded definitions.
  setContext("workflow-name", (workflowId: string) => workflowId === id ? name : workflowNames.get(workflowId));
  setContext("workflow-editor-active", () => keyboardActive);
  setContext("workflow-curve-strength", () => workflowDefaults.curveStrength);
  setContext("workflow-connection-options", () => ({ curved, strength: workflowDefaults.curveStrength,
    style: `${edgeOptions.style}; marker-end: url(#${connectionMarkerId})` }));
  setContext("workflow-input-type", (nodeId: string, handle = "value") => {
    if (handle === "value") return inputTypes.get(nodeId) ?? "Unknown";
    const edge = edges.find(edge => edge.kind === "mapping" && !edge.hidden && !edge.detached && edge.target === nodeId && edge.targetHandle === handle);
    return edge ? inputTypes.get(edge.source) ?? "Unknown" : "Unknown";
  });
  setContext("workflow-input-connected", (nodeId: string, handleId?: string | null) => workflowInputConnected(nodeId, handleId, edges));
  setContext("workflow-filter-assertion", {
    available: (nodeId: string) => canAddArrayFilterAssertion(nodeId, nodes, edges),
    add: (nodeId: string) => {
      if (!keyboardActive || placement) return;
      try {
        const assertionId = crypto.randomUUID();
        const graph = addArrayFilterAssertion(nodeId, assertionId, nodes, edges);
        validateWorkflowDocument({ ...documentValue(), ...graph });
        applyGraph(graph, true);
        error = "";
      } catch (failure) { describeFailure("Add assertion", failure); }
    }
  });
  setContext("workflow-add-property", {
    types: (nodeId: string) => getAdditionalPropertyTypes(nodes, nodeId, propertySchema(nodeId)),
    editable: (nodeId: string) => getEditableAdditionalProperties(nodes, nodeId, propertySchema(nodeId)),
    add: (nodeId: string, name: string, type: WorkflowField["type"]) => {
      if (!keyboardActive) throw new Error("The workflow is not available for editing.");
      applyPropertyGraph(addAdditionalProperty(nodes, edges, nodeId, name, type, propertySchema(nodeId)));
    },
    edit: (nodeId: string, fieldId: string, name: string, type: WorkflowField["type"]) => {
      if (!keyboardActive) throw new Error("The workflow is not available for editing.");
      const node = nodes.find(node => node.id === nodeId);
      const changedType = node?.type === "data" && node.data.fields.find(field => field.id === fieldId)?.type !== type;
      applyPropertyGraph(updateAdditionalProperty(nodes, edges, nodeId, fieldId, name, type, propertySchema(nodeId)), changedType);
    },
    remove: (nodeId: string, fieldId: string) => {
      if (!keyboardActive) throw new Error("The workflow is not available for editing.");
      applyPropertyGraph(removeAdditionalProperty(nodes, edges, nodeId, fieldId, propertySchema(nodeId)), false);
    }
  });
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
  setContext("workflow-processing", (nodeId: string, data: ProcessingData) => {
    if (!keyboardActive) return;
    const current = nodes.find(node => node.id === nodeId);
    if (current?.type !== "transform" && current?.type !== "filter" && current?.type !== "assert") return;
    const changed = nodes.map(node => node.id === nodeId ? { ...current, data } : node);
    let connections = edges;
    if (current.data.operation !== data.operation || current.data.parameters.type !== data.parameters.type
      || current.data.parameters.operator !== data.parameters.operator || current.data.parameters.path !== data.parameters.path) {
      const affected = new Set([nodeId]);
      for (const id of affected) for (const edge of connections) if (edge.kind === "mapping" && edge.source === id) affected.add(edge.target);
      const byId = new Map(changed.map(node => [node.id, node]));
      connections = connections.filter(edge => edge.kind !== "mapping" || !affected.has(edge.source) && !affected.has(edge.target)
        || isValueConnection(edge, byId.get(edge.source)!, byId.get(edge.target)!, connections.filter(other => other.id !== edge.id))
          && isWorkflowConnectionTypeCompatible(edge, changed, connections));
    }
    applyGraph({ nodes: changed, edges: connections }, true);
  });
  setContext("workflow-file", (nodeId: string, data: WorkflowFileData) => {
    if (!keyboardActive) return;
    const graph = updateFileDataGraph(nodeId, data, nodes, edges);
    validateWorkflowDocument({ ...documentValue(), ...graph });
    applyPropertyGraph(graph);
  });
  setContext("workflow-vault-variable", (nodeId: string, credentialId: string) => {
    if (keyboardActive) nodes = nodes.map(node => node.id === nodeId && node.type === "vault" ? { ...node, data: credentialId ? { credentialId } : {} } : node);
  });
  setContext("workflow-comment-resize", (nodeId: string, size?: { width: number; height: number }) => {
    resizingComment = !size;
    if (size) nodes = nodes.map(node => node.id === nodeId && node.type === "comment"
      ? { ...node, data: { ...node.data, ...size } } : node);
  });
  setContext("workflow-comment-text", (nodeId: string, text: string) => {
    if (keyboardActive) nodes = nodes.map(node => node.id === nodeId && node.type === "comment" ? { ...node, data: { ...node.data, text } } : node);
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
    const editing = textEditing || resizingComment || placement !== null || nodes.some(node => node.dragging);
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
        ...(edge.manualRoute ? { manualRoute: edge.manualRoute.map(point => ({ ...point })) } : {}),
        ...(version >= 2 ? { ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
          ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}), ...(edge.kind ? { kind: edge.kind } : {}),
          ...(edge.hidden ? { hidden: true } : {}), ...(edge.detached ? { detached: true } : {}) } : {}) })),
      viewport: { ...viewport }, snap, curved, dashed };
  }

  function storedNode(node: GraphNode): WorkflowDocumentNode {
    const common = { id: node.id, position: node.position, ...(node.hidden ? { hidden: true } : {}) };
    if (node.type === "comment") return { ...common, type: "comment", data: { ...node.data,
      ...(node.width ? { width: node.width } : {}), ...(node.height ? { height: node.height } : {}) } };
    if (node.type === "operation") return { ...common, ...(version >= 2 ? { type: "operation" as const } : {}), data: node.data };
    return { ...common, type: node.type, data: node.data } as WorkflowDocumentNode;
  }

  function propertySchema(nodeId: string): Record<string, unknown> {
    const node = nodes.find(node => node.id === nodeId);
    const owner = node?.type === "data" ? nodes.find(owner => owner.id === node.data.ownerId) : undefined;
    return owner?.type === "operation" ? catalogForOperation(owner.data.operationId)?.document ?? {} : {};
  }

  function graphNode(node: WorkflowDocumentNode): GraphNode {
    return { ...node, ...(node.type === "comment" ? { width: node.data.width, height: node.data.height } : {}), type: node.type ?? "operation" } as GraphNode;
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
    // Render in reading order without turning focus/measurement updates into document edits.
    updated = restoreWorkflowNodeOrder(nodes, updated);
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
    if (!keyboardActive || modifierPressed(event, keybindings.nodeSelection) || !(event.target instanceof Element) ||
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

  function applyPropertyGraph(graph: Pick<WorkflowDocument, "nodes" | "edges">, placeNewNodes = true) {
    validateWorkflowDocument({ ...documentValue(), ...graph });
    const addedIds = new Set(placeNewNodes ? graph.nodes.filter(node => !nodes.some(current => current.id === node.id)).map(node => node.id) : []);
    placement = tick().then(() => {
      const elements = new Map([...canvas?.querySelectorAll<HTMLElement>(".svelte-flow__node") ?? []]
        .map(element => [element.dataset.id, element]));
      const placed = new Map(nodes.map(node => [node.id, node]));
      for (const node of nodes) {
        const element = elements.get(node.id);
        if (!addedIds.has(node.id) || !element?.offsetWidth || !element.offsetHeight || node.type !== "data") continue;
        const input = node.data.direction === "inputs";
        const attachment = graph.edges.find(edge => edge.kind === "schema" && (input ? edge.source : edge.target) === node.id);
        const parent = attachment && placed.get(input ? attachment.target : attachment.source);
        const parentWidth = parent && elements.get(parent.id)?.offsetWidth;
        // Keep long property names clear of their new child panels in either direction.
        const position = parent && parentWidth ? { ...node.position,
          x: input ? parent.position.x - element.offsetWidth - 64 : parent.position.x + parentWidth + 64 } : node.position;
        placed.set(node.id, snapNodeCenter({ ...node, position, measured: { width: element.offsetWidth, height: element.offsetHeight } }));
      }
      // A new property can grow an existing panel without adding another node.
      // Use rendered sizes to keep lower panels clear of its fields and controls.
      const panels = [...placed.values()].filter(node => node.type === "data" && !node.hidden)
        .sort((a, b) => a.position.y - b.position.y);
      const positioned: { ownerId: string; direction: string; x: number; right: number; bottom: number }[] = [];
      for (const node of panels) {
        const element = elements.get(node.id);
        if (node.type !== "data" || !element?.offsetWidth || !element.offsetHeight) continue;
        const x = node.position.x;
        const right = x + element.offsetWidth;
        const y = Math.max(node.position.y, ...positioned.filter(previous =>
          previous.ownerId === node.data.ownerId && previous.direction === node.data.direction &&
          previous.x < right && previous.right > x).map(previous => previous.bottom + 32));
        const updated = y > node.position.y ? snapNodeCenter({ ...node, position: { x, y },
          measured: { width: element.offsetWidth, height: element.offsetHeight } }) : node;
        placed.set(node.id, updated);
        positioned.push({ ownerId: node.data.ownerId, direction: node.data.direction,
          x, right, bottom: updated.position.y + element.offsetHeight });
      }
      nodes = nodes.map(node => placed.get(node.id)!);
    }).finally(() => { placement = null; });
    applyGraph(graph);
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
    saveAttempt = null;
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

  async function hydrateSaved(state: WorkflowRepositoryState, focus: "name" | "canvas" | null = null, current: () => boolean = () => true) {
    await schemaLease.update(state.document);
    if (!alive || !current()) return;
    hydrate(state.document, true, true, focus);
    persistedRevision = state.revision;
    canUndo = state.canUndo;
    canRedo = state.canRedo;
  }

  onMount(() => {
    savedSnapshot = JSON.stringify(documentValue());
    initialDraft = JSON.parse(savedSnapshot);
    void refreshDocuments(true, true).then(async loaded => {
      if (!loaded) return;
      await tick();
      finishStartup();
    }).catch(async failure => {
      // Release the loader with the original failure even if rendering also fails.
      await tick().catch(() => {});
      finishStartup(failure);
    });
    const unsubscribe = workflowRepository.subscribe(() => { if (storageReady) void refreshDocuments(); });
    const hidden = () => { if (window.document.visibilityState === "hidden") void flushAutosave(); };
    const pageHidden = () => { void flushAutosave(); };
    const input = (event: Event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[contenteditable="true"]') ?? event.target : event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLElement && target.isContentEditable)) return;
      if (target instanceof HTMLInputElement && target.type === "file") return;
      if (!canvas?.contains(target) && target.id !== "workflow-name" && target.id !== "workflow-description") return;
      textEditTarget = target;
      textEditing = true;
    };
    const editableFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.isContentEditable) input(event);
    };
    const blur = (event: FocusEvent) => {
      if (event.target === textEditTarget) { textEditTarget = null; textEditing = false; }
    };
    window.addEventListener("pagehide", pageHidden);
    window.document.addEventListener("visibilitychange", hidden);
    window.document.addEventListener("input", input, true);
    window.document.addEventListener("focusin", editableFocus, true);
    window.document.addEventListener("focusout", blur, true);
    return () => {
      alive = false;
      void flushAutosave();
      unsubscribe();
      window.removeEventListener("pagehide", pageHidden);
      window.document.removeEventListener("visibilitychange", hidden);
      window.document.removeEventListener("input", input, true);
      window.document.removeEventListener("focusin", editableFocus, true);
      window.document.removeEventListener("focusout", blur, true);
    };
  });

  export async function refreshDocuments(restoreLatest = !storageReady, startup = false): Promise<boolean> {
    const generation = ++refreshGeneration;
    try {
      await workflowRepository.initialize();
      const loaded = await workflowRepository.list();
      if (!alive || generation !== refreshGeneration) return false;
      documents = loaded;
      libraryError = "";
      if (startup) reportStartup("load-workflow", documents.length ? undefined : "No saved workflow");
      let restored: WorkflowRepositoryState | undefined;
      if (restoreLatest && !nodes.length && !dirty) {
        const latest = documents.at(-1);
        if (latest) {
          restored = await workflowRepository.load(latest.id);
          if (!alive || generation !== refreshGeneration) return false;
        }
      }
      if (startup) reportStartup("canvas");
      if (restored) await hydrateSaved(restored, null, () => generation === refreshGeneration);
      if (!alive || generation !== refreshGeneration) return false;
      storageReady = true;
      return true;
    } catch (failure) {
      if (!alive || generation !== refreshGeneration) return false;
      libraryError = `Could not load saved workflows: ${failure instanceof Error ? failure.message : String(failure)}`;
      if (startup) throw failure;
      return false;
    }
  }

  const insertionPosition = () => ({ x: (180 - viewport.x) / viewport.zoom, y: (180 - viewport.y) / viewport.zoom });

  async function appendGraph(graph: Pick<WorkflowDocument, "nodes" | "edges">, nodeId: string, title: string, requiredVersion: 2 | 3, utility = false) {
    if (placement) await placement;
    try {
      if (nodes.length + graph.nodes.length > 500 || edges.length + graph.edges.length > 1000)
        throw new Error("A workflow supports at most 500 nodes and 1000 connections, including its schema panels.");
      const current = documentValue();
      validateWorkflowDocument({ ...current, version: Math.max(version, requiredVersion), nodes: [...current.nodes, ...graph.nodes], edges: [...current.edges, ...graph.edges] });
    } catch (failure) { describeFailure(`Could not add “${title}”`, failure); return; }
    const addedIds = new Set(graph.nodes.map(node => node.id));
    // Use rendered sizes to align the new tree and place it after existing content.
    placement = tick().then(() => {
      const elements = new Map([...canvas?.querySelectorAll<HTMLElement>(".svelte-flow__node") ?? []]
        .map(element => [element.dataset.id, element]));
      const measured = nodes.map(node => {
        const element = elements.get(node.id);
        return element?.offsetWidth && element.offsetHeight
          ? { ...node, measured: { width: element.offsetWidth, height: element.offsetHeight } }
          : node;
      });
      const added = measured.filter(node => addedIds.has(node.id));
      const existing = measured.filter(node => !addedIds.has(node.id));
      const positioned = new Map((utility && toolbar
        ? [placeUtilityNode(added[0]!, existing, toolbar.placementViewport(), gridSize)]
        : layoutAddedGraph(added, graph.edges, existing, gridSize, nodeId)).map(node => [node.id, node]));
      nodes = nodes.map(node => positioned.get(node.id) ?? node);
    }).finally(() => { placement = null; });
    version = Math.max(version, requiredVersion) as 2 | 3;
    nodes = [...nodes.map(node => ({ ...node, selected: false })), ...graph.nodes.map(node => ({ ...graphNode(node), selected: node.id === nodeId }))];
    edges = [...edges.map(edge => ({ ...edge, selected: false })), ...graph.edges.map(paintEdge)];
    error = "";
    notice = "";
    await placement;
    await tick();
    await toolbar?.reveal(nodeId, utility);
    if (active && !navigationModal) focusCanvas();
  }

  export async function addOperation(operation: Operation) {
    if (!storageReady && !await refreshDocuments()) return;
    if (documentModal || actionBusy) return;
    const nodeId = crypto.randomUUID();
    const owner = {};
    pinOperationModels(owner, new Set([operation.id]));
    try {
      const canonical = await hydrateOperation(operation.id);
      let schema: Record<string, unknown> | undefined;
      try { schema = getOperationReport(canonical).schema; }
      catch { /* The graph shows an unavailable-schema notice for unbundled operations. */ }
      await appendGraph(createOperationGraph(canonical, insertionPosition(), nodeId, schema), nodeId, canonical.name, 2);
      await schemaLease.update(documentValue());
    }
    catch (failure) { describeFailure(`Could not add “${operation.name}”`, failure); }
    finally { pinOperationModels(owner); }
  }

  async function changeOperationVersion(nodeId: string, operationId: string) {
    if (!keyboardActive || changingOperationVersion) return;
    const node = nodes.find(node => node.id === nodeId);
    if (!node || node.type !== "operation" || node.data.operationId === operationId) return;
    const previousId = node.data.operationId;
    const target = operationIndex.variants.get(previousId)?.find(operation => operation.id === operationId && !operation.unavailableReason);
    if (!target) return;
    const revision = getSchemaLibrary().revision;
    const workflowId = id;
    const owner = {};
    changingOperationVersion = true;
    pinOperationModels(owner, new Set([operationId]));
    try {
      const canonical = await hydrateOperation(operationId);
      const current = nodes.find(node => node.id === nodeId);
      if (!alive || !keyboardActive || id !== workflowId || current?.type !== "operation" ||
        current.data !== node.data || getSchemaLibrary().revision !== revision) return;
      const graph = updateOperationVersion(nodeId, canonical, getOperationReport(canonical).schema, nodes, edges);
      const nextVersion = Math.max(version, 2) as 2 | 3;
      validateWorkflowDocument({ ...documentValue(), version: nextVersion, ...graph });
      version = nextVersion;
      applyPropertyGraph(graph);
      await schemaLease.update(documentValue());
      error = "";
    } catch (failure) { describeFailure("Could not change API version", failure); }
    finally { changingOperationVersion = false; pinOperationModels(owner); }
  }

  async function addUtility(type: "switch" | "cast" | "comment" | "vault" | "file" | "stop" | ProcessingKind) {
    if (!keyboardActive) return;
    const nodeId = crypto.randomUUID();
    await appendGraph({ nodes: [createUtilityNode(type, insertionPosition(), nodeId)], edges: [] }, nodeId, type, 3, true);
  }

  export async function addWorkflow(document: WorkflowDocument) {
    if (!storageReady && !await refreshDocuments()) return;
    if (documentModal || actionBusy) return;
    const nodeId = crypto.randomUUID();
    try { await appendGraph(createWorkflowGraph(document, insertionPosition(), nodeId), nodeId, document.name, 3); }
    catch (failure) { describeFailure(`Could not add “${document.name}”`, failure); }
  }

  export async function startRun(document: WorkflowDocument = documentValue()) {
    if (actionBusy || !document.nodes.length) return;
    actionBusy = true;
    try {
      const validated = validateWorkflowDocument(document);
      await runSchemaLease.update(validated);
      runDocument = validated;
      runOpen = true;
      error = "";
    } catch (failure) { describeFailure("Could not run this workflow", failure); }
    finally { actionBusy = false; }
  }

  function describeWorkflow() { descriptionError = ""; descriptionOpen = true; }

  function bindRunCredential(path: string[], binding: CredentialBinding) {
    const update = <T extends { id: string; data: unknown }>(items: T[], trail: string[]): T[] => items.map(node => {
      if (node.id !== trail[0]) return node;
      const data = node.data as Record<string, unknown>;
      if (trail.length === 1) return { ...node, data: { ...data, credentialBinding: structuredClone(binding) } };
      const snapshot = data.snapshot as WorkflowDocument | undefined;
      return snapshot ? { ...node, data: { ...data, snapshot: { ...snapshot, nodes: update(snapshot.nodes, trail.slice(1)) } } } : node;
    });
    if (runDocument?.id === id) nodes = update(nodes, path);
  }

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
    const edge = { id: crypto.randomUUID(), source: connection.source, target: connection.target,
      ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
      ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
      ...(fieldMapping ? { kind: "mapping" as const } : {}) };
    try {
      const graph = insertFileBinaryCast(edge, nodes, edges, crypto.randomUUID());
      if (graph) { applyGraph(graph); return null; }
    } catch (failure) { describeFailure("Connect file", failure); return null; }
    return paintEdge(edge);
  }

  function connectToPanel(connection: Connection) {
    const edge = prepareConnection(connection);
    if (edge) { edges = addEdge(edge, edges); adaptGates(); }
  }

  function adaptGates() {
    const upgraded = new Set(nodes.filter(node => node.type === "filter" && node.data.operation === "array_filter"
      && Object.hasOwn(node.data.parameters, "operator") && edges.some(edge => edge.kind === "mapping" &&
        (edge.source === node.id && edge.sourceHandle === "item" || edge.target === node.id && (edge.targetHandle === "success" || edge.targetHandle === "failure"))))
      .map(node => node.id));
    if (upgraded.size) {
      // Switching a saved inline predicate to an Assert path is one undoable edit.
      edges = edges.filter(edge => !upgraded.has(edge.target) || edge.targetHandle !== "path" && edge.targetHandle !== "expected");
      nodes = nodes.map(node => node.type === "filter" && upgraded.has(node.id) ? { ...node, data: { ...node.data, parameters: {} } } : node);
    }
    nodes = adaptRoutingGates(nodes, edges).map(graphNode);
  }

  function copySelection(cut = false) {
    const copied = copyWorkflowSelection(documentValue(), nodes.filter(node => node.selected).map(node => node.id), edges.filter(edge => edge.selected).map(edge => edge.id));
    if (!copied) return;
    clipboard = copied;
    pasteOffset = 32;
    if (cut) {
      void beforeDelete({ nodes: nodes.filter(node => node.selected && node.deletable !== false), edges: edges.filter(edge => edge.selected && edge.deletable !== false) });
    }
  }

  async function pasteSelection() {
    if (!clipboard || !keyboardActive || placement) return;
    try {
      const graph = pasteWorkflowSelection(clipboard, pasteOffset);
      const nextVersion = Math.max(version, graph.version) as 1 | 2 | 3;
      validateWorkflowDocument({ ...documentValue(), version: nextVersion, nodes: [...nodes.map(storedNode), ...graph.nodes], edges: [...documentValue().edges, ...graph.edges] });
      version = nextVersion;
      pasteOffset += 32;
      nodes = [...nodes.map(node => ({ ...node, selected: false })), ...graph.nodes.map(node => ({ ...graphNode(node), selected: !node.hidden }))];
      edges = [...edges.map(edge => ({ ...edge, selected: false })), ...graph.edges.map(edge => ({ ...paintEdge(edge), selected: !edge.hidden }))];
      error = "";
      await tick();
      await toolbar?.reveal(graph.nodes.filter(node => !node.hidden).map(node => node.id));
      if (keyboardActive) focusCanvas();
    } catch (failure) { describeFailure("Could not paste selection", failure); }
  }

  function removeSelected() {
    applyGraph(removeGraphSelection({ nodes: nodes.filter(node => node.selected), edges: edges.filter(edge => edge.selected) }, nodes, edges), true);
  }

  async function beforeDelete(selection: { nodes: GraphNode[]; edges: GraphEdge[] }) {
    if (keyboardActive && !window.document.activeElement?.closest("#settings-panel")) applyGraph(removeGraphSelection(selection, nodes, edges), true);
    return false;
  }

  function switchCurve() {
    setCurvedConnections(!curved);
  }

  export function setCurvedConnections(enabled: boolean) {
    curved = enabled;
    edges = edges.map(edge => ({ ...edge, type: curved ? "default" : "smoothstep" }));
  }

  function switchDashes() {
    dashed = !dashed;
    edges = edges.map(edge => ({ ...edge, animated: dashed, style: edgeOptions.style }));
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
    // A new explicit flush retries a failed in-flight save before newer edits.
    if (savePromise) await savePromise;
    while (dirty) {
      if (!await save()) return false;
    }
    return true;
  }

  async function save(inConfirmation = false, savingSnapshot = snapshot): Promise<boolean> {
    cancelAutosave();
    if (!storageReady) return false;
    if (savePromise && queuedSnapshot === savingSnapshot) return savePromise;
    if (!savePromise && !saveAttempt && savingSnapshot === savedSnapshot) return true;
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
        if (saveAttempt) {
          // Finalization can fail after Git has durably committed this edit.
          // Recover that exact attempt before advancing a newer draft, retaining
          // its expected revision so actual other-tab conflicts still fail.
          const attempted = saveAttempt;
          const recovered = await workflowRepository.save(JSON.parse(attempted.snapshot), attempted.expectedRevision);
          if (id !== savingId) return false;
          acceptSave(recovered, attempted.snapshot);
          saveAttempt = null;
        }
        if (savingSnapshot === savedSnapshot) return true;
        let expectedRevision = persistedRevision;
        if (expectedRevision === null && initialDraft?.id === savingId) {
          const baseline = await workflowRepository.save(initialDraft, null, "Create workflow");
          expectedRevision = baseline.revision;
          if (id === savingId) persistedRevision = baseline.revision;
          initialDraft = null;
        }
        saveAttempt = { snapshot: savingSnapshot, expectedRevision };
        const state = await workflowRepository.save(value, expectedRevision);
        if (id === savingId) {
          acceptSave(state, savingSnapshot);
          saveAttempt = null;
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

  function acceptSave(state: WorkflowRepositoryState, saved: string) {
    persistedRevision = state.revision;
    savedSnapshot = saved;
    hasSavedDocument = true;
    canUndo = state.canUndo;
    canRedo = state.canRedo;
    saveError = "";
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
    removal = null; removalError = ""; dialogOpen = true;
  }

  function openDocument(document: WorkflowDocument) {
    intent += 1;
    replacementCompleted = true;
    dialogOpen = false;
    void replace(async () => hydrateSaved(await workflowRepository.load(document.id), "canvas"), true);
  }

  async function removeDocument() {
    if (!removal || actionBusy) return;
    const requested = removal;
    actionBusy = true;
    cancelAutosave();
    try {
      if (savePromise) await savePromise;
      if (requested.id !== id && !await flushAutosave())
        throw new Error(saveError || "The current workflow could not be saved.");
      await workflowRepository.remove([requested.id]);
      if (requested.id === id) {
        cancelAutosave();
        id = crypto.randomUUID();
        savedSnapshot = snapshot;
        initialDraft = JSON.parse(snapshot);
        hasSavedDocument = false;
        persistedRevision = null;
        saveAttempt = null;
        canUndo = canRedo = false;
        saveError = "";
      }
      await refreshDocuments();
      removal = null;
      removalError = "";
      await tick();
      window.document.querySelector<HTMLElement>(".document-entry, .modal-close")?.focus();
    } catch (failure) { removalError = `Could not remove “${requested.name}”: ${failure instanceof Error ? failure.message : String(failure)}`; }
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

  async function changeVersion(action: "undo" | "redo" | "checkout", oid?: string) {
    if (actionBusy || !storageReady) return;
    const restoreWorkflowFocus = canvas?.contains(window.document.activeElement);
    actionBusy = true;
    historyError = "";
    try {
      if (!await flushAutosave() || !persistedRevision) throw new Error(saveError || "Save this workflow before changing versions.");
      const state = action === "checkout"
        ? await workflowRepository.checkout(id, oid!, persistedRevision)
        : await workflowRepository[action](id, persistedRevision);
      await hydrateSaved(state);
      await refreshDocuments();
      if (historyOpen) revisions = await workflowRepository.history(id);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (historyOpen) historyError = message;
      else { error = message; retry = () => { void changeVersion(action, oid); }; }
    } finally {
      actionBusy = false;
      await tick();
      // Making the canvas inert can clear its focus. Do not steal focus from
      // another control the user deliberately selected during the operation.
      if (restoreWorkflowFocus && window.document.activeElement === window.document.body) focusCanvas();
    }
  }

  function historyShortcut(event: KeyboardEvent) {
    if (!keyboardActive || event.defaultPrevented || event.isComposing) return;
    const target = event.target;
    if (target instanceof Element && target.closest('#settings-panel, input, textarea, select, [contenteditable], [role="listbox"], [role="combobox"], .nokey')) return;
    const action = shortcutAction(event, keybindings);
    if (action === "newWorkflow" || action === "openWorkflow" || action === "runWorkflow" || action === "history" || action === "copy" || action === "cut" || action === "paste") {
      event.preventDefault();
      if (action === "newWorkflow") newDocument();
      else if (action === "openWorkflow") openDocuments();
      else if (action === "runWorkflow") startRun();
      else if (action === "history") void openHistory();
      else if (action === "paste") void pasteSelection();
      else copySelection(action === "cut");
      return;
    }
    if (action === "deleteSelection") {
      event.preventDefault();
      void beforeDelete({ nodes: nodes.filter(node => node.selected && node.deletable !== false), edges: edges.filter(edge => edge.selected && edge.deletable !== false) });
      return;
    }
    if (action === "selectAll") {
      event.preventDefault();
      nodes = nodes.map(node => ({ ...node, selected: !node.hidden && node.selectable !== false }));
      const selectedIds = new Set(nodes.filter(node => node.selected).map(node => node.id));
      edges = edges.map(edge => ({ ...edge, selected: !edge.hidden && edge.selectable !== false &&
        selectedIds.has(edge.source) && selectedIds.has(edge.target) }));
      return;
    }
    const undo = action === "undo";
    if (undo || action === "redo") {
      event.preventDefault();
      if (undo ? canUndo || dirty : canRedo && !dirty) void changeVersion(undo ? "undo" : "redo");
    }
  }

  function exportDocument() {
    try {
      const document = portableWorkflowDocument(documentValue());
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

  async function confirmRemoval(document: WorkflowDocument) {
    removal = document;
    removalError = "";
    await tick();
    cancelRemoval?.focus();
  }

  async function cancelRemove() {
    const id = removal?.id;
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

<section class="workflow-workspace" class:populated={nodes.length > 0} class:hide-node-symbols={!workflowDefaults.nodeSymbols}
  style:--workflow-dash-length={workflowDefaults.dashLength} style:--workflow-dash-gap={workflowDefaults.dashGap}
  style:--flow-routing-dash-period={dashPeriod} style:--flow-routing-dash-duration={`${dashPeriod / Math.max(1, workflowDefaults.dashSpeed)}s`}
  style:--flow-routing-dash-play-state={workflowDefaults.dashSpeed === 0 ? "paused" : "running"}
  tabindex="-1" aria-label="Workflow canvas" inert={graphBlocked} bind:this={canvas} onkeydowncapture={moveSnappedNodes} ondblclickcapture={selectNodeBranch}>
  <span class="sr-only" aria-live="assertive" aria-atomic="true">{movementAnnouncement}</span>
  {#if activated}
  {#key revision}
    <SvelteFlowProvider>
    <RoutingScope enabled={active} editable={keyboardActive} {dashPeriod}
      options={{ nodePadding: workflowDefaults.nodeClearance }}
      onroutechange={(id, points) => {
        if (!keyboardActive) return;
        edges = edges.map(edge => {
          if (edge.id !== id) return edge;
          const { manualRoute: previous, ...rest } = edge;
          return points ? { ...rest, manualRoute: points.map(point => ({ ...point })) } : rest;
        });
      }}
      createClient={createWorkflowRoutingClient} resolveConnection={state => connectionSnap?.preview(state) ?? state}
      onerror={cause => {
        const failure = new Error("Workflow edge routing stopped. Standard connection paths remain available. Reopen the workflow to retry.", { cause });
        error = failure.message;
        logger.error(failure.message, failure);
      }}>
    <SvelteFlow bind:nodes={() => orderedNodes, updateCanvasNodes} bind:edges bind:viewport {nodeTypes} {edgeTypes} defaultEdgeOptions={edgeOptions} connectionLineComponent={WorkflowConnectionLine} connectionLineType={curved ? ConnectionLineType.Bezier : ConnectionLineType.SmoothStep} onbeforeconnect={prepareConnection} onconnect={adaptGates}
      elevateEdgesOnSelect={false} defaultMarkerColor={null} connectionLineStyle={`${edgeOptions.style}; marker-end: url(#${connectionMarkerId})`}
      minZoom={0.25} maxZoom={2} {...(snap ? {} : { snapGrid: [1, 1] as [number, number] })}
      deleteKey={[]} selectionKey={keyboardActive ? modifierKeys(keybindings.areaSelection) : null}
      multiSelectionKey={keyboardActive ? (keybindings.nodeSelection === "Shift" ? ["Shift", "Meta", "Control"] : modifierKeys(keybindings.nodeSelection)) : null} panActivationKey={keyboardActive ? " " : null}
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
      <WorkflowSelection menuOpen={navigationOpen || settingsOpen} {canvas} {keybindings} active={keyboardActive} />
      <WorkflowConnectionSnap bind:this={connectionSnap} isValidConnection={validConnection} active={keyboardActive} {curved} {dashed} curveStrength={workflowDefaults.curveStrength} markerEnd={`url(#${connectionMarkerId})`} />
      {#if nodes.length}<WorkflowMinimap active={keyboardActive} />{/if}
      <WorkflowToolbar buttons={toolbarButtons} bind:this={toolbar} {canvas} {active} {settingsOpen} {navigationOpen} {snap} {curved} {dashed} {selected} placing={placement !== null}
        onsnap={() => snap = !snap} oncurved={switchCurve} ondashed={switchDashes}
        oncopy={() => copySelection()} oncut={() => copySelection(true)} onpaste={() => { void pasteSelection(); }} canPaste={clipboard !== null}
        onremove={removeSelected} onnew={newDocument} onopen={openDocuments}
        onexport={exportDocument} onimport={() => upload.click()} onbrowse={onBrowse}
        onutility={addUtility} ondescribe={describeWorkflow} onrun={() => startRun()} canRun={nodes.length > 0}
        canUndo={canUndo || (hasSavedDocument && dirty)} canRedo={canRedo && !dirty} historyBusy={actionBusy || saving}
        onundo={() => changeVersion("undo")} onredo={() => changeVersion("redo")} onhistory={openHistory} />
    </SvelteFlow>
    </RoutingScope>
    </SvelteFlowProvider>
  {/key}
  {/if}
  {#if !nodes.length}
    <div class="workflow-empty"><Button aria-label="Browse operations" onclick={onBrowse}><span>Add nodes<br />by selecting workflow operations<br />from the left menu</span></Button></div>
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
  {:else if historyOpen}<WorkflowHistory workflowId={id} {revisions} currentRevision={persistedRevision} busy={actionBusy} onselect={(oid) => changeVersion("checkout", oid)} />{/if}
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

<Modal bind:open={runOpen} size="wide" title={`Run workflow: ${runDocument?.name ?? name}`}
  onCloseAutoFocus={(event) => { event.preventDefault(); void tick().then(focusCanvas); }}>
  {#if runOpen && runDocument}<WorkflowRun document={runDocument} onClose={() => runOpen = false} onBindingChange={bindRunCredential} />{/if}
</Modal>

<Modal bind:open={replacementOpen} title="Unsaved changes" description={`“${name}” has unsaved changes. Save them before replacing this workflow?`} initialFocus={() => cancelReplacement} onCloseAutoFocus={restoreReplacementFocus}>
  {#if replacementError}<p role="alert" class="error">{replacementError}</p>{/if}
  <div class="modal-actions">
    <Button tooltip="Save this workflow before continuing" onclick={() => continueReplacement(true)}>Save and continue</Button>
    <Button variant="outline" tooltip="Continue without saving changes" onclick={() => continueReplacement(false)}>Discard changes</Button>
    <HintButton class="text-button" bind:ref={cancelReplacement} aria-label="Cancel" label="Keep editing this workflow" onclick={() => replacementOpen = false}>Cancel</HintButton>
  </div>
</Modal>

<Modal bind:open={dialogOpen} title="Saved workflows"
  onCloseAutoFocus={(event) => { if (replacementCompleted) { event.preventDefault(); replacementCompleted = false; } }}
  onEscapeKeydown={(event) => { if (removal) { event.preventDefault(); void cancelRemove(); } }}>
  {#if removal}
    <div class="removal-confirmation" role="group" aria-label="Confirm removal">
      <p>Remove “{removal.name}” from this browser?</p>
      {#if removalError}<p role="alert" class="error">{removalError}</p>{/if}
      <div class="modal-actions"><Button variant="outline" tooltip="Remove this saved workflow from this browser" onclick={removeDocument}>{removalError ? "Try again" : "Remove"}</Button>
        <HintButton class="text-button" bind:ref={cancelRemoval} aria-label="Cancel" label="Keep this saved workflow" onclick={cancelRemove}>Cancel</HintButton></div>
    </div>
  {:else}
  {#if libraryError}<p role="alert" class="error">{libraryError}</p><Button onclick={() => refreshDocuments()}>Retry</Button>{/if}
  {#if !documents.length}<p>No saved workflows yet.</p>{/if}
  <ul class="saved-documents">{#each documents as document (document.id)}
    <li data-document-id={document.id}>
      <HintButton class="document-entry" aria-label={`${document.name} ${documentSummary(document)}`} label={`Open ${document.name}`} onclick={() => openDocument(document)}><strong>{document.name}</strong><span>{documentSummary(document)}</span></HintButton>
      <HintButton class="document-remove" aria-label={`Remove ${document.name}`} label={`Remove ${document.name} from saved workflows`} onclick={() => confirmRemoval(document)}><MaterialIcon name="delete" size={18} /></HintButton></li>
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
  .saved-documents { display: grid; gap: 16px; padding-block: 8px; }
  .saved-documents li { position: relative; align-items: stretch; gap: 0; padding: 0; border-radius: 4px; background: var(--color-background); transition: transform 180ms ease-in; }
  .saved-documents :global(.document-entry), .saved-documents :global(.document-remove) { background: transparent; color: inherit; }
  .saved-documents :global(.document-remove) { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 40px; padding: 0; border: 0; border-left: 1px solid var(--color-surface); border-radius: 0 4px 4px 0; }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .saved-documents li:has(:global(.document-entry:enabled)):not([inert] *) { will-change: transform; }
    .saved-documents li:has(:global(button:is(:hover,:focus-visible))) { z-index: 1; transform: scale(min(1.10, var(--hover-scale, 1.10))); }
    .saved-documents :global(.document-remove .material-symbols-rounded) { transition: transform 180ms ease-in; }
    .saved-documents :global(.document-remove:hover .material-symbols-rounded) { transform: scale(1.4); }
  }
  :global(.workflow-workspace .svelte-flow) { --xy-edge-stroke-default: var(--color-graph-line); --xy-edge-stroke-width: 2; --xy-edge-stroke-selected-default: var(--color-emphasis); --xy-connectionline-stroke-default: var(--color-emphasis); --xy-connectionline-stroke-width: 2; --xy-background-pattern-dots-color-default: color-mix(in srgb, var(--color-foreground) var(--workspace-dot-opacity), transparent); --xy-background-color-default: transparent; --xy-selection-background-color: color-mix(in srgb, var(--color-accent) 8%, transparent); --xy-selection-border: 1px dashed var(--color-accent); background: transparent; }
  /* Node contents provide focus feedback; wrapper outlines flash on blur. */
  .workflow-workspace,
  :global(.workflow-workspace :is(.svelte-flow, .svelte-flow__renderer, .svelte-flow__pane, .svelte-flow__background)) { outline: none; }
  :global(.workflow-workspace .svelte-flow__node) { outline: none; transition: none; }
  :global(.workflow-workspace.hide-node-symbols .svelte-flow__node :is(.operation-title-row, .data-title, .utility-title, .workflow-kind) > .material-symbols-rounded) { display: none; }
  /* Remove inactive outlines immediately instead of fading from currentColor. */
  :global(.workflow-workspace:not(:focus-visible)),
  :global(.workflow-workspace :where(button, a[href], summary, input, select, textarea, [tabindex]):not(:focus-visible):not(:is(input, select, textarea):hover:enabled)) { outline-style: none; }
  :global(.workflow-workspace .svelte-flow__arrowhead polyline) { stroke: context-stroke; }
  :global(.workflow-workspace .svelte-flow__arrowhead polyline.arrowclosed) { fill: context-stroke; }
  :global(.workflow-workspace .svelte-flow__edge-path) { transition: stroke 120ms ease-in, stroke-width 120ms ease-in; }
  :global(.workflow-workspace .svelte-flow__edge.animated .svelte-flow__edge-path:not(.flow-routing-dash):not(.flow-routing-dash-base)) { animation-name: workflow-dashes; animation-duration: var(--flow-routing-dash-duration); animation-play-state: var(--flow-routing-dash-play-state); }
  /* Disabled form controls swallow mouseup in Chromium; the canvas owns a drag. */
  :global(.workflow-workspace .svelte-flow:has(.svelte-flow__connectionline) .svelte-flow__node :is(input, textarea, select, button)) { pointer-events: none; }
  @keyframes workflow-dashes {
    from { stroke-dashoffset: calc(var(--flow-routing-dash-period) * 1px); }
    to { stroke-dashoffset: 0; }
  }
  :global(.workflow-workspace .svelte-flow__edge:hover .svelte-flow__edge-path) { stroke-width: 3px; }
</style>
