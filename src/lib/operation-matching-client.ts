// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import MatchingWorker from "./operation-matching.worker.ts?worker&inline";
import type { Operation } from "./catalog.ts";
import type { OperationEvaluation } from "./matching.ts";
import { createMatchingIndexCache, type MatchingCatalog } from "./matching-index.ts";
import { createWorkerClient } from "./worker-rpc.ts";

export type TimedOperationEvaluation = OperationEvaluation & { durationMs: number; considered: number };
const snapshots = createMatchingIndexCache();
export const prepareOperationMatching = (operations: Operation[]) => snapshots.prepare(operations);
type Session = { client: ReturnType<typeof createWorkerClient>; catalogs: Map<string, MatchingCatalog>; revision?: string; failure?: Error };
type Score = { id: string; similarity: number };

/** Reuse completed searches. Abort still terminates executing CPU work immediately. */
export function createOperationMatchingEvaluator(factory: () => Worker = () => new MatchingWorker({ name: "operation-matching" }))
{
  let session: Session | undefined;
  let active: { session: Session } | undefined;
  function reset(current: Session) {
    current.client.dispose(true);
    if (session === current) session = undefined;
  }
  function start(): Session {
    const current: Session = { catalogs: new Map(), client: createWorkerClient(() => {
      const worker = factory();
      delete current.failure;
      const invalidate = (event: Event) => {
        delete current.revision; current.catalogs.clear();
        current.failure = new Error(event.type === "error" ? (event as ErrorEvent).message || "The matching worker stopped." : "Could not read the matching worker's response.");
        current.failure.name = "WorkerError";
      };
      worker.addEventListener("error", invalidate);
      worker.addEventListener("messageerror", invalidate);
      return worker;
    }, { scope: "operation-matching" }) };
    return current;
  }
  const evaluate = async (prompt: string, operations: Operation[], signal: AbortSignal, details = true): Promise<TimedOperationEvaluation> => {
    signal.throwIfAborted();
    const started = performance.now();
    if (active) reset(active.session);
    const current = session ??= start();
    const request = { session: current };
    active = request;
    const cancel = () => { if (active === request) { reset(current); active = undefined; } };
    signal.addEventListener("abort", cancel, { once: true });
    const requireActive = () => {
      signal.throwIfAborted();
      if (active !== request) throw new DOMException("The background calculation was replaced.", "AbortError");
      if (current.failure) throw current.failure;
    };
    try
    {
      const snapshot = prepareOperationMatching(operations);
      if (current.revision !== snapshot.revision) {
        const updates = snapshot.catalogs.filter(catalog => current.catalogs.get(catalog.id) !== catalog);
        await current.client.call("configure", [updates, snapshot.catalogs.map(catalog => catalog.id), snapshot.revision]);
        requireActive();
        current.catalogs = new Map(snapshot.catalogs.map(catalog => [catalog.id, catalog]));
        current.revision = snapshot.revision;
      }
      requireActive();
      const response = await current.client.call<{ candidates: Score[]; results: Score[]; considered: number }>(
        "search", [prompt, snapshot.revision, details]);
      requireActive();
      const candidates = response.candidates.map(match => ({ operation: snapshot.byId.get(match.id)!, similarity: match.similarity }));
      const matchedById = new Map(candidates.map(match => [match.operation.id, match]));
      return { candidates, results: response.results.map(match => matchedById.get(match.id)
        ?? { operation: snapshot.byId.get(match.id)!, similarity: match.similarity }),
        considered: response.considered, durationMs: performance.now() - started };
    }
    catch (error) { reset(current); throw error; }
    finally
    {
      signal.removeEventListener("abort", cancel);
      if (active === request) active = undefined;
    }
  };
  return Object.assign(evaluate, { dispose() { if (session) reset(session); active = undefined; } });
}

export const evaluateOperationsAsync = createOperationMatchingEvaluator();
import.meta.hot?.dispose(evaluateOperationsAsync.dispose);
