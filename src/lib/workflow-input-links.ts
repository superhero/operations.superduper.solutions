// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { WorkflowDocument, WorkflowDocumentEdge, WorkflowDocumentNode } from './workflow-document.ts';
import { responseGroup as schemaGroup, schemaShape } from './workflow-response-links.ts';

type Connection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

function tree(root: string, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): WorkflowDocumentNode[] {
  const ids = new Set([root]);
  for (const id of ids) for (const edge of edges)
    if (edge.kind === 'schema' && edge.target === id && nodes.some(node => node.id === edge.source && node.type === 'data' && node.data.direction === 'inputs')) ids.add(edge.source);
  return nodes.filter(node => ids.has(node.id));
}

export function isInputLink(connection: Connection, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): boolean {
  const source = nodes.find(node => node.id === connection.source);
  const owner = nodes.find(node => node.id === connection.target);
  if (source?.type !== 'data' || source.hidden || hasInputLink(source.id, edges) || source.data.direction !== 'inputs' || connection.sourceHandle !== 'value' ||
    !owner || owner.hidden || owner.type !== undefined && owner.type !== 'operation' || source.data.ownerId === owner.id) return false;
  const own = edges.find(edge => edge.kind === 'schema' && edge.source === source.id && edge.target === source.data.ownerId);
  const destination = edges.find(edge => edge.kind === 'schema' && edge.target === owner.id && edge.targetHandle === connection.targetHandle);
  if (!own || !destination || edges.some(edge => edge.kind === 'input' && edge.target === owner.id && edge.targetHandle === connection.targetHandle)) return false;
  const group = schemaGroup(source.id, source.data.ownerId, nodes);
  if (!group?.startsWith('input:') || group !== schemaGroup(destination.source, owner.id, nodes)) return false;
  const targets = new Set(tree(destination.source, nodes, edges).map(node => node.id));
  if (edges.some(edge => edge.kind === 'mapping' && targets.has(edge.target))) return false;
  return JSON.stringify(schemaShape(source.id, nodes, edges)) === JSON.stringify(schemaShape(destination.source, nodes, edges));
}

/** Expand shared inputs into ordinary field fan-out for the execution engine. */
export function expandInputLinks(document: WorkflowDocument): WorkflowDocument {
  const visible = new Set<string>();
  const mappings: WorkflowDocumentEdge[] = [];
  for (const link of document.edges.filter(edge => edge.kind === 'input' && !edge.hidden && !edge.detached)) {
    const destination = document.edges.find(edge => edge.kind === 'schema' && edge.target === link.target && edge.targetHandle === link.targetHandle)!;
    const original = tree(link.source, document.nodes, document.edges);
    const shared = tree(destination.source, document.nodes, document.edges);
    for (const node of shared) visible.add(node.id);
    for (const node of original) {
      if (node.type !== 'data') continue;
      const matching = shared.find(other => other.type === 'data' && other.data.fields[0]?.id === node.data.fields[0]?.id);
      if (!matching) continue;
      for (const edge of document.edges.filter(edge => edge.kind === 'mapping' && edge.target === node.id && !edge.hidden && !edge.detached))
        mappings.push({ ...edge, id: `${link.id}:${edge.id}`, target: matching.id });
    }
  }
  return { ...document, nodes: document.nodes.map(node => visible.has(node.id) ? { ...node, hidden: false } : node),
    edges: [...document.edges.filter(edge => edge.kind !== 'input'), ...mappings] };
}

/** Shared destinations receive their fields from the linked panel, not local mappings. */
export function hasInputLink(nodeId: string, edges: WorkflowDocumentEdge[]): boolean {
  const seen = new Set<string>();
  while (!seen.has(nodeId)) {
    seen.add(nodeId);
    const parent = edges.find(edge => edge.kind === 'schema' && edge.source === nodeId && edge.sourceHandle === 'value');
    if (!parent) return false;
    if (edges.some(edge => edge.kind === 'input' && edge.target === parent.target && edge.targetHandle === parent.targetHandle)) return true;
    nodeId = parent.target;
  }
  return false;
}
