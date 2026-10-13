// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { ConnectionState, InternalNodeBase, Viewport } from "@xyflow/system";
import type { RoutingEdge, RoutingScene } from "./types.js";

export interface SceneNode {
  id: string;
  hidden?: boolean | undefined;
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null | undefined;
  targetHandle?: string | null | undefined;
  type?: string | undefined;
  hidden?: boolean | undefined;
  detached?: boolean | undefined;
}

/** Derive absolute measured rectangles and outer handle endpoints from XYFlow internals. */
export function routingScene<NodeType extends InternalNodeBase>(
  nodes: readonly SceneNode[],
  edges: readonly SceneEdge[],
  getInternalNode: (id: string) => NodeType | undefined
): RoutingScene;

/** Only valid snapped targets have target node ownership. */
export function connectionGeometry<NodeType extends InternalNodeBase>(
  connection: ConnectionState<NodeType>
): RoutingEdge | null;

/** Convert the raw pointer to diagram coordinates independently of XYFlow handle snapping. */
export function pointerGeometry<NodeType extends InternalNodeBase>(
  connection: ConnectionState<NodeType>,
  viewport: Viewport
): RoutingEdge | null;
