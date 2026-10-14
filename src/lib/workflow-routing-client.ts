// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import RoutingWorker from './workflow-routing.worker.ts?worker&inline';
import { createWorkerClient } from './worker-rpc.ts';
import type { RoutingRequest, RoutingReply } from './flow-routing/session.js';

export function createWorkflowRoutingClient() {
  const client = createWorkerClient(() => new RoutingWorker({ name: 'workflow-edge-routing' }), { scope: 'edge-routing' });
  return {
    calculate: (input: RoutingRequest) => client.call<RoutingReply>('calculate', [input]),
    // Routing has no writes to drain when the canvas closes or changes mode.
    dispose: () => client.dispose(true),
  };
}
