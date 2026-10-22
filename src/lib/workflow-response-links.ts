// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { WorkflowDocumentEdge, WorkflowDocumentNode } from './workflow-document.ts';

export function responseGroup(id: string, owner: string, nodes: WorkflowDocumentNode[] = []): string | undefined {
  const panel = nodes.find(node => node.id === id);
  const fieldId = panel?.type === "data" ? panel.data.fields[0]?.id : undefined;
  const encoded = fieldId ?? (id.startsWith(`${owner}:`) ? id.slice(owner.length + 1) : undefined);
  if (!encoded) return;
  try {
    const identity = JSON.parse(decodeURIComponent(encoded));
    if (Array.isArray(identity) && typeof identity[0] === 'string') return identity[0];
  } catch { /* Not a generated response identity. */ }
}

// Compare the complete generated field tree, independent of status and panel IDs.
function shape(root: string, nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[], seen = new Set<string>()): unknown {
  if (seen.has(root)) return "cycle";
  seen = new Set([...seen, root]);
  const panel = nodes.find(node => node.id === root);
  if (panel?.type !== 'data') return '';
  return { array: panel.data.array, fields: panel.data.fields.map(field => {
    let path: unknown;
    try { path = JSON.parse(decodeURIComponent(field.id))[1]; } catch { path = field.id; }
    const child = edges.find(edge => edge.kind === 'schema' && edge.source === root && edge.sourceHandle === field.id);
    return { path, type: field.type, required: field.required, connectable: field.connectable,
      array: field.array, itemType: field.itemType, child: child ? shape(child.target, nodes, edges, seen) : undefined };
  }) };
}

export function isResponseLink(connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null },
  nodes: WorkflowDocumentNode[], edges: WorkflowDocumentEdge[]): boolean {
  const owner = nodes.find(node => node.id === connection.source);
  const target = nodes.find(node => node.id === connection.target);
  if (!owner || owner.hidden || owner.type !== undefined && owner.type !== 'operation' || target?.type !== 'data' || target.hidden ||
      target.data.ownerId !== owner.id || target.data.direction !== 'outputs' || connection.targetHandle !== 'value') return false;
  const original = edges.find(edge => edge.kind === 'schema' && edge.source === owner.id && edge.sourceHandle === connection.sourceHandle);
  const attachment = edges.find(edge => edge.kind === 'schema' && edge.source === owner.id && edge.target === target.id);
  if (!original || !attachment || original.target === target.id || !responseGroup(original.target, owner.id, nodes)?.startsWith('response:') ||
      !responseGroup(target.id, owner.id, nodes)?.startsWith('response:')) return false;
  return !edges.some(edge => edge.kind === 'response' && edge.source === owner.id && edge.sourceHandle === connection.sourceHandle) &&
    JSON.stringify(shape(original.target, nodes, edges)) === JSON.stringify(shape(target.id, nodes, edges));
}

export function linkedResponseGroups(panelId: string, owner: string, edges: WorkflowDocumentEdge[], nodes: WorkflowDocumentNode[]): string[] {
  // Descendant panel identities share their root response group.
  const group = responseGroup(panelId, owner, nodes);
  return edges.filter(edge => edge.kind === 'response' && !edge.hidden && !edge.detached && edge.source === owner &&
    responseGroup(edge.target, owner, nodes) === group).flatMap(link => {
      const root = edges.find(edge => edge.kind === 'schema' && edge.source === owner && edge.sourceHandle === link.sourceHandle);
      const sourceGroup = root && responseGroup(root.target, owner, nodes);
      return sourceGroup ? [sourceGroup] : [];
    });
}
