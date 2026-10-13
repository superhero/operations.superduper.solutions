// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { NodeRect, Route, RoutingEdge } from './types.js';

export const routingContext = Symbol('svelte-flow-routing');
export interface RoutingContext {
  route(id: string): Route | undefined;
  /** Node bounds plus clearance, shared by every rounded renderer. */
  obstacles(): NodeRect[];
  preview(): Route | null;
  connection(): RoutingEdge | null;
  dashPeriod(): number;
}
