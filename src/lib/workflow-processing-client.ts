// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createWorkerClient } from "./worker-rpc.ts";
import type { ProcessingData, ProcessingKind } from "./workflow-processing.ts";
import type { PrivateExpression } from "./secrets/processing.ts";
export type ProcessingExecutor = {
  process: (kind: ProcessingKind, data: ProcessingData, value: unknown, key?: unknown, parameters?: Record<string, unknown>) => Promise<unknown>;
  assertPrivate: (expression: PrivateExpression, data: ProcessingData, signal?: AbortSignal, parameters?: Record<string, PrivateExpression>) => Promise<boolean>;
  dispose: () => void;
};
/** One lazily created public worker per run. Private values use only the vault. */
export function createProcessingExecutor(): ProcessingExecutor {
  let client: ReturnType<typeof createWorkerClient> | undefined;
  let closed = false;
  return {
    async process(kind, data, value, key, parameters) {
      if (!client) {
        const { default: ProcessingWorker } = await import("./workflow-processing.worker.ts?worker&inline");
        if (closed) throw new Error("Workflow processing was cancelled.");
        client = createWorkerClient(() => new ProcessingWorker({ name: "workflow-processing" }), { reportErrors: false, scope: "workflow-processing" });
      }
      return client.call("process", [kind, data, value, key, parameters]);
    },
    async assertPrivate(expression, data, signal, parameters) {
      const { vaultCall } = await import("./secrets/client.ts");
      if (closed) throw new Error("Workflow processing was cancelled.");
      return vaultCall("checkAssertion", [expression, data, parameters], signal);
    },
    dispose() { closed = true; client?.dispose(true); client = undefined; },
  };
}
