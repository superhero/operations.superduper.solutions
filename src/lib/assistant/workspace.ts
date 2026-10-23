// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";
import { validateWorkflowDocument, type WorkflowDocument } from "../workflow-document.ts";
import { createOperationGraph, insertFileBinaryCast, isWorkflowConnection } from "../workflow-graph.ts";
import { isInputLink } from "../workflow-input-links.ts";
import { isResponseLink } from "../workflow-response-links.ts";
import { adaptRoutingGates } from "../workflow-utilities.ts";
import type { AssistantEdit, AssistantPort } from "./tools.ts";

/** Same canonical graph rules as pointer edits. No execution code is reachable. */
export function editAssistantWorkspace(document: WorkflowDocument, edit: AssistantEdit, ports: AssistantPort[],
  operation?: { value: Operation; schema: Record<string, unknown> }) {
  if (edit.workflowId !== document.id) throw new Error("The current workflow changed. Read it again before editing.");
  let nodes = document.nodes, edges = document.edges;
  let nodeId: string | undefined;
  if (edit.kind === "add_operation") {
    if (!operation || operation.value.id !== edit.operationId || operation.value.unavailableReason) throw new Error("The operation is unavailable.");
    nodeId = crypto.randomUUID();
    const graph = createOperationGraph(operation.value, { x: edit.x, y: edit.y }, nodeId, operation.schema);
    nodes = [...nodes, ...graph.nodes]; edges = [...edges, ...graph.edges];
  } else if (edit.kind === "move_nodes") {
    const moves = new Map(edit.moves.map(move => [move.nodeId, move]));
    if (moves.size !== edit.moves.length || edit.moves.some(move => !nodes.some(node => node.id === move.nodeId && !node.hidden)))
      throw new Error("Move only distinct visible nodes in the current workflow.");
    nodes = nodes.map(node => { const move = moves.get(node.id); return move ? { ...node, position: { x: move.x, y: move.y } } : node; });
  } else {
    const hasPort = (nodeId: string, handle: string | undefined, direction: AssistantPort["direction"]) =>
      ports.some(port => port.nodeId === nodeId && port.handle === (handle ?? null) && port.direction === direction && port.available);
    if (!hasPort(edit.source, edit.sourceHandle, "output") || !hasPort(edit.target, edit.targetHandle, "input") || !isWorkflowConnection(edit, nodes, edges))
      throw new Error("Those ports are unavailable, occupied or incompatible. Read the current ports before connecting.");
    const edge = { id: crypto.randomUUID(), source: edit.source, target: edit.target,
      ...(edit.sourceHandle === undefined ? {} : { sourceHandle: edit.sourceHandle }), ...(edit.targetHandle === undefined ? {} : { targetHandle: edit.targetHandle }),
      ...(isInputLink(edit, nodes, edges) ? { kind: "input" as const } : isResponseLink(edit, nodes, edges) ? { kind: "response" as const } :
        edit.sourceHandle || edit.targetHandle ? { kind: "mapping" as const } : {}) };
    const cast = insertFileBinaryCast(edge, nodes, edges, crypto.randomUUID());
    if (cast) { nodes = cast.nodes; edges = cast.edges; }
    else edges = [...edges, edge];
    nodes = adaptRoutingGates(nodes, edges);
  }
  const next = validateWorkflowDocument({ ...document, version: Math.max(document.version, 2), nodes, edges });
  return { document: next, ...(nodeId ? { nodeId } : {}) };
}
