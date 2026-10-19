// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import MatchingWorker from "./operation-matching.worker.ts?worker&inline";
import type { Operation } from "./catalog.ts";
import { prepareMatchingOperations, type OperationEvaluation } from "./matching.ts";
import { createWorkerClient } from "./worker-rpc.ts";

export type TimedOperationEvaluation = OperationEvaluation & { durationMs: number };
const snapshots = new WeakMap<Operation[], { prepared: ReturnType<typeof prepareMatchingOperations>;
  byId: Map<string, Operation> }>();

export function prepareOperationMatching(operations: Operation[]) {
  if (!snapshots.has(operations)) snapshots.set(operations, {
    prepared: prepareMatchingOperations(operations.map(({ id, name }) => ({ id, name }))),
    byId: new Map(operations.map(operation => [operation.id, operation])),
  });
  return snapshots.get(operations)!;
}

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
      const snapshot = prepareOperationMatching(operations);
      const evaluation = await client.call<{ candidates: { id: string; similarity: number }[]; results: string[] }>(
        "evaluatePrepared", [prompt, snapshot.prepared]);
      signal.throwIfAborted();
      const candidates = evaluation.candidates.map(match => ({ operation: snapshot.byId.get(match.id)!, similarity: match.similarity }));
      const matchedById = new Map(candidates.map(match => [match.operation.id, match]));
      return { candidates, results: evaluation.results.map(id => matchedById.get(id)!),
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
