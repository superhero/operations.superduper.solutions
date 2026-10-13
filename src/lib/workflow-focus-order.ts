// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { WorkflowDocumentEdge, WorkflowDocumentNode } from "./workflow-document.ts";

/** Order schema columns for keyboard navigation without changing saved positions. */
export function orderWorkflowNodes<T extends WorkflowDocumentNode>(nodes: readonly T[],
  edges: readonly WorkflowDocumentEdge[]): T[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const children = new Map<string, { node: T; direction: "inputs" | "outputs"; fieldOrder: number }[]>();
  for (const edge of edges) {
    if (edge.kind !== "schema") continue;
    const source = byId.get(edge.source), target = byId.get(edge.target);
    const input = source?.type === "data" && source.data.direction === "inputs";
    const child = input ? source : target, parent = input ? target : source;
    if (!parent || child?.type !== "data" || child.data.direction !== (input ? "inputs" : "outputs")) continue;
    if (parent.type === "data"
      ? parent.data.ownerId !== child.data.ownerId || parent.data.direction !== child.data.direction
      : parent.id !== child.data.ownerId) continue;
    const handle = input ? edge.targetHandle : edge.sourceHandle;
    const fieldOrder = parent.type === "data" ? parent.data.fields.findIndex(field => field.id === handle) : -1;
    const siblings = children.get(parent.id) ?? [];
    siblings.push({ node: child, direction: child.data.direction, fieldOrder: fieldOrder < 0 ? Infinity : fieldOrder });
    children.set(parent.id, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((left, right) => left.fieldOrder - right.fieldOrder || indices.get(left.node.id)! - indices.get(right.node.id)!);

  const ordered: T[] = [];
  const emitted = new Set<string>();
  const append = (node: T) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    ordered.push(node);
  };
  const layers = (owner: T, direction: "inputs" | "outputs") => {
    const result: T[][] = [];
    const depths = new Map([[owner.id, 0]]);
    for (const [parentId, depth] of depths) {
      for (const branch of children.get(parentId) ?? []) {
        if (branch.direction !== direction || depths.has(branch.node.id)) continue;
        depths.set(branch.node.id, depth + 1);
        (result[depth] ??= []).push(branch.node);
      }
    }
    return result;
  };
  for (const owner of nodes) {
    if (owner.type === "data") continue;
    for (const layer of layers(owner, "inputs").reverse()) for (const node of layer) append(node);
    append(owner);
    for (const layer of layers(owner, "outputs")) for (const node of layer) append(node);
  }
  // Keep hidden branches and incomplete, temporarily disconnected nodes in state.
  for (const node of nodes) append(node);
  return ordered;
}

/** Accept node updates while keeping the document's existing order stable. */
export function restoreWorkflowNodeOrder<T extends { id: string }>(current: readonly T[], updated: readonly T[]): T[] {
  const remaining = new Map(updated.map(node => [node.id, node]));
  const restored: T[] = [];
  for (const node of [...current, ...updated]) {
    const replacement = remaining.get(node.id);
    if (!replacement) continue;
    restored.push(replacement);
    remaining.delete(node.id);
  }
  return restored;
}
