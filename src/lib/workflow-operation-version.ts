// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { WorkflowDocumentNode, WorkflowDocumentEdge } from "./workflow-document.ts";
import { createOperationGraph } from "./workflow-graph.ts";
import { isValueConnection, isWorkflowConnectionTypeCompatible } from "./workflow-utilities.ts";

/** Replace the canonical contract, retaining the owner, panel positions and compatible mappings. */
export function updateOperationVersion(nodeId: string, operation: Operation, document: Record<string, unknown>,
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[])
{
  const owner = nodes.find(node => node.id === nodeId);
  if (!owner || owner.type !== undefined && owner.type !== "operation") return { nodes, edges };
  const generated = createOperationGraph(operation, owner.position, nodeId, document);
  const panels = new Map(nodes.filter(node => node.type === "data" && node.data.ownerId === nodeId).map(node => [node.id, node]));
  const replacement = generated.nodes[0]!;
  if (replacement.type === "operation" && owner.data.credentialBinding)
    replacement.data.credentialBinding = owner.data.credentialBinding;
  // Older workflows express ordering through owner-to-owner links. Keep that
  // representation: adding schema panels would make those legacy links invalid.
  if (edges.some(edge => !edge.kind && (edge.source === nodeId || edge.target === nodeId)))
    return { nodes: nodes.map(node => node === owner ? { ...owner, ...replacement } : node), edges };
  const nextNodes = nodes.filter(node => !panels.has(node.id)).map(node => node === owner ? { ...owner, ...replacement } : node);
  nextNodes.push(...generated.nodes.slice(1).map(node => {
    const old = panels.get(node.id);
    return old ? { ...node, position: old.position, ...(old.hidden ? { hidden: true } : {}) } : node;
  }));
  const previousEdges = new Map(edges.map(edge => [edge.id, edge]));
  const nextEdges = [...edges.filter(edge => edge.kind !== "schema" || !panels.has(edge.source) && !panels.has(edge.target)),
    ...generated.edges.map(edge => ({ ...previousEdges.get(edge.id), ...edge }))];
  const index = new Map(nextNodes.map(node => [node.id, node]));
  // Newly introduced descendants inherit a closed branch rather than appearing on their own.
  for (const node of generated.nodes.slice(1)) {
    const attachment = generated.edges.find(edge => edge.id === `schema:${node.id}`)!;
    const parent = index.get(attachment.source === node.id ? attachment.target : attachment.source)!;
    if (parent.hidden) index.get(node.id)!.hidden = true;
  }
  const connected = nextEdges.filter(edge => {
    const source = index.get(edge.source), target = index.get(edge.target);
    return source && target && (edge.kind !== "mapping" ||
      isValueConnection(edge, source, target, nextEdges.filter(other => other.id !== edge.id)));
  });
  return { nodes: nextNodes, edges: connected.filter(edge => edge.kind !== "mapping" ||
    isWorkflowConnectionTypeCompatible(edge, nextNodes, connected)).map(edge =>
      index.get(edge.source)!.hidden || index.get(edge.target)!.hidden || edge.detached ? { ...edge, hidden: true } : edge) };
}
