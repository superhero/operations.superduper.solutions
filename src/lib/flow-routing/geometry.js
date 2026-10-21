// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { ConnectionMode, getEdgePosition, getHandlePosition } from '@xyflow/system';

// Read measured geometry through Svelte Flow, never through the DOM or viewport.
export function routingScene(nodes, edges, getInternalNode) {
  const visible = new Map(nodes.filter(node => !node.hidden).map(node => [node.id, getInternalNode(node.id)]));
  const obstacles = [];
  for (const [id, node] of visible) {
    if (!node?.measured?.width || !node.measured.height || node.type === 'group') continue;
    obstacles.push({ id, ...node.internals.positionAbsolute, ...node.measured });
  }
  const connections = [];
  for (const edge of edges) {
    if (edge.hidden || edge.detached || ![undefined, 'default', 'smoothstep'].includes(edge.type)) continue;
    const sourceNode = visible.get(edge.source);
    const targetNode = visible.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const position = getEdgePosition({
      id: edge.id, sourceNode, targetNode, sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle, connectionMode: ConnectionMode.Strict,
    });
    if (position) connections.push({ id: edge.id, source: edge.source, target: edge.target, ...position,
      ...(edge.manualRoute !== undefined ? { manualRoute: edge.manualRoute.map(point => ({ x: point.x, y: point.y })) } : {}) });
  }
  return { nodes: obstacles, edges: connections };
}

export function connectionGeometry(connection) {
  if (!connection.inProgress) return null;
  // Drag coordinates use handle centers; completed edges use their outer side.
  // Resolve the local handle because toHandle already contains absolute centers.
  const endpoint = (node, handle, fallback) => {
    const local = node?.internals?.handleBounds?.[handle?.type]?.find(item => (item.id ?? null) === (handle.id ?? null));
    return local ? getHandlePosition(node, local, local.position) : fallback;
  };
  const target = connection.isValid === true ? connection.toNode : null;
  const from = endpoint(connection.fromNode, connection.fromHandle, connection.from);
  const to = target ? endpoint(target, connection.toHandle, connection.to) : connection.to;
  return {
    id: '__connection-preview__', source: connection.fromNode.id, target: target?.id,
    sourceX: from.x, sourceY: from.y, sourcePosition: connection.fromPosition,
    targetX: to.x, targetY: to.y, targetPosition: connection.toPosition,
  };
}

// The pointer stays in canvas pixels even when XYFlow snaps `to` to a handle.
export function pointerGeometry(connection, { x, y, zoom }) {
  const edge = connectionGeometry(connection);
  if (!edge || !connection.pointer) return edge;
  return {
    ...edge, target: undefined,
    targetX: (connection.pointer.x - x) / zoom,
    targetY: (connection.pointer.y - y) / zoom,
    targetPosition: { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[connection.fromPosition],
  };
}
