// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { Connection, InternalNode, OnConnectEnd, XYPosition, useConnection } from "@xyflow/svelte";

export type WorkflowConnectionState = ReturnType<typeof useConnection>["current"];
export type WorkflowConnectionEnd = Parameters<OnConnectEnd>[1];
type ConnectionOrigin = Pick<WorkflowConnectionEnd, "fromNode" | "fromHandle" | "isValid"> & { inProgress?: boolean };
export type WorkflowHandle = NonNullable<WorkflowConnectionState["fromHandle"]>;
export type WorkflowSnapTarget = {
  connection: Connection;
  node: InternalNode;
  handle: WorkflowHandle;
  point: XYPosition;
};

/** Native handle snapping wins; body snapping ranks only inputs that can accept this connection. */
export function nearestWorkflowInput(
  origin: ConnectionOrigin,
  nodes: Array<InternalNode | undefined>,
  pointer: XYPosition,
  isValidConnection: (connection: Connection) => boolean,
  isHandleAvailable: (node: InternalNode, handle: WorkflowHandle) => boolean = () => true
): WorkflowSnapTarget | null {
  if (!origin.fromNode || origin.fromHandle?.type !== "source" || origin.inProgress === false ||
      origin.isValid === true || origin.fromNode.hidden || origin.fromNode.connectable === false ||
      !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;

  let selected: WorkflowSnapTarget | null = null;
  let selectedZ = -Infinity;
  for (const node of nodes) {
    if (!node || node.id === origin.fromNode.id || node.hidden || node.connectable === false) continue;
    const { positionAbsolute: position, handleBounds } = node.internals;
    const { width, height } = node.measured;
    if (width === undefined || height === undefined || width <= 0 || height <= 0 ||
        ![position.x, position.y, width, height].every(Number.isFinite) ||
        pointer.x < position.x || pointer.x > position.x + width ||
        pointer.y < position.y || pointer.y > position.y + height) continue;

    const z = Number.isFinite(node.internals.z) ? node.internals.z : 0;
    if (z < selectedZ) continue;
    let nearest: WorkflowSnapTarget | null = null;
    let nearestDistance = Infinity;
    for (const handle of handleBounds?.target ?? []) {
      if (handle.type !== "target" || handle.width <= 0 || handle.height <= 0 ||
          ![handle.x, handle.y, handle.width, handle.height].every(Number.isFinite) ||
          !isHandleAvailable(node, handle)) continue;
      const connection = {
        source: origin.fromNode.id,
        sourceHandle: origin.fromHandle.id ?? null,
        target: node.id,
        targetHandle: handle.id ?? null
      };
      if (!isValidConnection(connection)) continue;
      const point = {
        x: position.x + handle.x + handle.width / 2,
        y: position.y + handle.y + handle.height / 2
      };
      const distance = (point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { connection, node, handle, point };
      }
    }
    if (nearest) { selected = nearest; selectedZ = z; }
  }
  return selected;
}
