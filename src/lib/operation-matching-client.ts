// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import MatchingWorker from "./operation-matching.worker.ts?worker&inline";
import type { Operation } from "./catalog.ts";
import type { MatchableOperation, OperationEvaluation } from "./matching.ts";
import { createWorkerClient } from "./worker-rpc.ts";

export type TimedOperationEvaluation = OperationEvaluation & { durationMs: number };

/** Each calculation owns its worker so aborting also stops its CPU work. */
export function createOperationMatchingEvaluator(factory: () => Worker = () => new MatchingWorker({ name: "operation-matching" }))
{
  return async (prompt: string, operations: Operation[], signal: AbortSignal): Promise<TimedOperationEvaluation> => {
    signal.throwIfAborted();
    const started = performance.now();
    const client = createWorkerClient(factory, { scope: "operation-matching" });
    const cancel = () => client.dispose(true);
    signal.addEventListener("abort", cancel, { once: true });
    try
    {
      // Schemas, examples and request fields stay on the page.
      const evaluation = await client.call<OperationEvaluation<MatchableOperation>>("evaluate", [prompt,
        operations.map(({ id, name }) => ({ id, name }))]);
      signal.throwIfAborted();
      const byId = new Map(operations.map(operation => [operation.id, operation]));
      const candidates = evaluation.candidates.map(match => ({ operation: byId.get(match.operation.id)!, similarity: match.similarity }));
      const matchedById = new Map(candidates.map(match => [match.operation.id, match]));
      return { candidates, results: evaluation.results.map(match => matchedById.get(match.operation.id)!),
        durationMs: performance.now() - started };
    }
    finally
    {
      signal.removeEventListener("abort", cancel);
      client.dispose(true);
    }
  };
}

export const evaluateOperationsAsync = createOperationMatchingEvaluator();
