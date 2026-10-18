// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { WorkflowDocument } from "./workflow-document.ts";

export type WorkflowClipboard = Pick<WorkflowDocument, "version" | "nodes" | "edges">;

/** Include owned schema panels together so pasted graphs remain independently valid. */
export function copyWorkflowSelection(document: WorkflowDocument, nodeIds: readonly string[], edgeIds: readonly string[]): WorkflowClipboard | null {
  const included = new Set(nodeIds);
  const selectedEdges = new Set(edgeIds);
  for (const edge of document.edges) if (selectedEdges.has(edge.id)) { included.add(edge.source); included.add(edge.target); }
  for (const node of document.nodes) if (included.has(node.id) && node.type === "data") included.add(node.data.ownerId);
  for (const node of document.nodes) if (node.type === "data" && included.has(node.data.ownerId)) included.add(node.id);
  const nodes = document.nodes.filter(node => included.has(node.id));
  if (!nodes.length) return null;
  return structuredClone({ version: document.version, nodes,
    edges: document.edges.filter(edge => included.has(edge.source) && included.has(edge.target)) });
}

/** New identities for every paste; snapshot endpoints remain scoped to their nested workflow. */
export function pasteWorkflowSelection(clipboard: WorkflowClipboard, offset = 32, nextId = () => crypto.randomUUID()): WorkflowClipboard {
  const graph = structuredClone(clipboard);
  const ids = new Map(graph.nodes.map(node => [node.id, nextId()]));
  const edges = new Map(graph.edges.map(edge => {
    const child = edge.kind === "schema" ? graph.nodes.find(node => `schema:${node.id}` === edge.id) : undefined;
    return [edge.id, child ? `schema:${ids.get(child.id)!}` : nextId()];
  }));
  for (const node of graph.nodes) {
    node.id = ids.get(node.id)!;
    node.position = { x: node.position.x + offset, y: node.position.y + offset };
    if (node.type === "data") node.data.ownerId = ids.get(node.data.ownerId)!;
  }
  for (const edge of graph.edges) {
    edge.id = edges.get(edge.id)!;
    edge.source = ids.get(edge.source)!;
    edge.target = ids.get(edge.target)!;
    if (edge.sourceHandle) edge.sourceHandle = edges.get(edge.sourceHandle) ?? edge.sourceHandle;
    if (edge.targetHandle) edge.targetHandle = edges.get(edge.targetHandle) ?? edge.targetHandle;
    if (edge.manualRoute) edge.manualRoute = edge.manualRoute.map(point => ({ x: point.x + offset, y: point.y + offset }));
  }
  return graph;
}
