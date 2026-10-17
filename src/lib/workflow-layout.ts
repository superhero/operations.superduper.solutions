// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { WorkflowDocumentEdge, WorkflowDocumentNode } from "./workflow-document.ts";

export type WorkflowLayoutNode = WorkflowDocumentNode & {
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

function dimensions(node: WorkflowLayoutNode) {
  return {
    width: node.measured?.width || node.width || (node.type === "data" ? 260 : 160),
    height: node.measured?.height || node.height || (node.type === "data" ? 64 + Math.max(node.data.fields.length, 1) * 34 : 80)
  };
}

/** Arrange a newly rendered graph without moving any existing, user-positioned nodes. */
export function layoutAddedGraph<T extends WorkflowLayoutNode>(added: readonly T[], edges: readonly WorkflowDocumentEdge[],
  existing: readonly WorkflowLayoutNode[], gridSize: number, ownerId: string): T[] {
  const visible = added.filter(node => !node.hidden);
  const owner = visible.find(node => node.id === ownerId);
  if (!owner) return [...added];
  const grid = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 1;
  const snap = (value: number) => Math.round(value / grid) * grid;
  // Extra grid clearance prevents independently snapped centers from closing a gap.
  const columnGap = 64 + grid, rowGap = 32 + grid;
  const byId = new Map(visible.map(node => [node.id, node]));
  const sizes = new Map(visible.map(node => [node.id, dimensions(node)]));
  const ownerSize = sizes.get(ownerId)!;
  const previous = existing.filter(node => !node.hidden);
  const previousOwner = previous.findLast(node => node.type !== "data") ?? previous.at(-1);
  const center = {
    x: snap(owner.position.x + ownerSize.width / 2),
    y: snap(previousOwner ? previousOwner.position.y + dimensions(previousOwner).height / 2 : owner.position.y + ownerSize.height / 2)
  };
  const centers = new Map([[ownerId, center]]);

  for (const direction of ["inputs", "outputs"] as const) {
    const input = direction === "inputs";
    const children = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.kind !== "schema" || edge.hidden) continue;
      const parentId = input ? edge.target : edge.source;
      const childId = input ? edge.source : edge.target;
      const child = byId.get(childId);
      if (!byId.has(parentId) || child?.type !== "data" || child.data.direction !== direction || child.data.ownerId !== ownerId) continue;
      const siblings = children.get(parentId) ?? [];
      if (!siblings.includes(childId)) siblings.push(childId);
      children.set(parentId, siblings);
    }

    const widths = [ownerSize.width];
    const depths = new Map([[ownerId, 0]]);
    // Traverse only this owner's schema tree; user mappings are not layout edges.
    for (const [parentId, depth] of depths) {
      for (const childId of children.get(parentId) ?? []) {
        if (depths.has(childId)) continue;
        depths.set(childId, depth + 1);
        widths[depth + 1] = Math.max(widths[depth + 1] ?? 0, sizes.get(childId)!.width);
      }
    }
    const columns = [center.x];
    for (let depth = 1; depth < widths.length; depth++)
      columns[depth] = columns[depth - 1]! + (input ? -1 : 1) * (widths[depth - 1]! / 2 + columnGap + widths[depth]! / 2);

    const spans = new Map<string, number>();
    const descendants = (id: string) => (children.get(id) ?? []).filter(child => depths.get(child) === depths.get(id)! + 1);
    for (const id of [...depths.keys()].reverse()) {
      const children = descendants(id);
      spans.set(id, Math.max(sizes.get(id)!.height,
        children.reduce((sum, child) => sum + spans.get(child)!, 0) + Math.max(0, children.length - 1) * rowGap));
    }
    const placeChildren = (id: string, centerY: number) => {
      const children = descendants(id);
      const height = children.reduce((sum, child) => sum + spans.get(child)!, 0) + Math.max(0, children.length - 1) * rowGap;
      let top = centerY - height / 2;
      for (const childId of children) {
        const childY = top + spans.get(childId)! / 2;
        centers.set(childId, { x: snap(columns[depths.get(childId)!]!), y: snap(childY) });
        placeChildren(childId, childY);
        top += spans.get(childId)! + rowGap;
      }
    };
    placeChildren(ownerId, center.y);
  }

  const positioned = added.map(node => {
    if (node.hidden) return node;
    const size = sizes.get(node.id)!;
    const point = centers.get(node.id) ?? { x: snap(node.position.x + size.width / 2), y: snap(node.position.y + size.height / 2) };
    return { ...node, position: { x: point.x - size.width / 2, y: point.y - size.height / 2 } };
  });
  if (!previous.length) return positioned;

  // Append the entire tree to the right, even when its inputs extend left of its owner.
  const right = Math.max(...previous.map(node => node.position.x + dimensions(node).width));
  const left = Math.min(...positioned.filter(node => !node.hidden).map(node => node.position.x));
  const shift = Math.ceil((right + 80 + grid - left) / grid) * grid;
  return positioned.map(node => ({ ...node, position: { x: node.position.x + shift, y: node.position.y } }));
}

export type WorkflowVisibleArea = { x: number; y: number; width: number; height: number };

/** Find the closest free node center, preferring complete containment in the viewport. */
export function placeUtilityNode<T extends WorkflowLayoutNode>(node: T, existing: readonly WorkflowLayoutNode[],
  viewport: WorkflowVisibleArea, gridSize = 0): T {
  const size = dimensions(node), half = { x: size.width / 2, y: size.height / 2 };
  const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const grid = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 0;
  const obstacles = existing.filter(item => !item.hidden).map(item => {
    const bounds = dimensions(item);
    return { left: item.position.x - half.x - 24, right: item.position.x + bounds.width + half.x + 24,
      top: item.position.y - half.y - 24, bottom: item.position.y + bounds.height + half.y + 24 };
  });
  const search = (left: number, right: number, top: number, bottom: number) => {
    const xs = new Set<number>();
    const add = (x: number) => {
      for (const value of grid ? [Math.floor(x / grid) * grid, Math.ceil(x / grid) * grid] : [x])
        if (value >= left && value <= right) xs.add(value);
    };
    add(center.x);
    if (Number.isFinite(left)) add(left);
    if (Number.isFinite(right)) add(right);
    for (const obstacle of obstacles) { add(obstacle.left); add(obstacle.right); }
    let best: { x: number; y: number; distance: number } | undefined;
    for (const x of [...xs].sort((a, b) => Math.abs(a - center.x) - Math.abs(b - center.x))) {
      const dx = (x - center.x) ** 2;
      if (best && dx > best.distance) break;
      const blocked = obstacles.filter(item => x > item.left && x < item.right)
        .map(item => [item.top, item.bottom] as const).sort((a, b) => a[0] - b[0]);
      let start = top;
      const consider = (end: number) => {
        const low = grid ? Math.ceil(start / grid) * grid : start;
        const high = grid ? Math.floor(Math.min(end, bottom) / grid) * grid : Math.min(end, bottom);
        if (low > high) return;
        const y = Math.max(low, Math.min(high, grid ? Math.round(center.y / grid) * grid : center.y));
        const distance = dx + (y - center.y) ** 2;
        if (!best || distance < best.distance) best = { x, y, distance };
      };
      for (const [low, high] of blocked) {
        if (low >= start) consider(low);
        start = Math.max(start, high);
      }
      consider(bottom);
    }
    return best;
  };
  const inside = search(viewport.x + half.x, viewport.x + viewport.width - half.x,
    viewport.y + half.y, viewport.y + viewport.height - half.y);
  const point = inside ?? search(-Infinity, Infinity, -Infinity, Infinity)!;
  return { ...node, position: { x: point.x - half.x, y: point.y - half.y } };
}
