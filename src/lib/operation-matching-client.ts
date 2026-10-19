// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import MatchingWorker from "./operation-matching.worker.ts?worker&inline";
import type { Operation } from "./catalog.ts";
import type { OperationEvaluation } from "./matching.ts";
import { createMatchingIndexCache, type MatchingCatalog, type MatchingSnapshot } from "./matching-index.ts";
import { createWorkerClient } from "./worker-rpc.ts";

export type TimedOperationEvaluation = OperationEvaluation & { durationMs: number; considered: number };
const snapshots = createMatchingIndexCache();
export const prepareOperationMatching = (operations: Operation[]) => {
  const snapshot = snapshots.prepare(operations);
  evaluateOperationsAsync.invalidate(snapshot.revision);
  return snapshot;
};
type Session = { client: ReturnType<typeof createWorkerClient>; catalogs: Map<string, MatchingCatalog>; revision?: string; failure?: Error; installing?: { revision: string; work: Promise<void> } };
type Score = { id: string; similarity: number };

/** Reuse completed searches and in-flight index installation. A cancelled
 * installation never starts scoring; cancelling active CPU work terminates it. */
export function createOperationMatchingEvaluator(factory: () => Worker = () => new MatchingWorker({ name: "operation-matching" }))
{
  let session: Session | undefined;
  let active: { session: Session; phase: "configure" | "search" } | undefined;
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
  function configure(current: Session, snapshot: MatchingSnapshot): Promise<void> {
    if (current.installing?.revision === snapshot.revision) return current.installing.work;
    const install = async () => {
      const updates = snapshot.catalogs.filter(catalog => current.catalogs.get(catalog.id) !== catalog);
      await current.client.call("configure", [updates, snapshot.catalogs.map(catalog => catalog.id), snapshot.revision]);
      if (current.failure) throw current.failure;
      current.catalogs = new Map(snapshot.catalogs.map(catalog => [catalog.id, catalog]));
      current.revision = snapshot.revision;
    };
    const work = current.installing ? current.installing.work.then(install) : install();
    const pending = { revision: snapshot.revision, work };
    current.installing = pending;
    void work.finally(() => { if (current.installing === pending) delete current.installing; }).catch(() => {});
    return work;
  }
  const evaluate = async (prompt: string, operations: Operation[], signal: AbortSignal, details = true): Promise<TimedOperationEvaluation> => {
    signal.throwIfAborted();
    const started = performance.now();
    if (active?.phase === "search") reset(active.session);
    const current = session ??= start();
    const request = { session: current, phase: "configure" as "configure" | "search" };
    active = request;
    const cancel = () => { if (active === request) {
      if (request.phase === "search") reset(current);
      active = undefined;
    } };
    signal.addEventListener("abort", cancel, { once: true });
    const requireActive = () => {
      signal.throwIfAborted();
      if (active !== request) throw new DOMException("The background calculation was replaced.", "AbortError");
      if (current.failure) throw current.failure;
    };
    try
    {
      const snapshot = snapshots.prepare(operations);
      if (current.installing || current.revision !== snapshot.revision) await configure(current, snapshot);
      requireActive();
      request.phase = "search";
      const response = await current.client.call<{ candidates: Score[]; results: Score[]; considered: number }>(
        "search", [prompt, snapshot.revision, details]);
      requireActive();
      const candidates = response.candidates.map(match => ({ operation: snapshot.byId.get(match.id)!, similarity: match.similarity }));
      const matchedById = new Map(candidates.map(match => [match.operation.id, match]));
      return { candidates, results: response.results.map(match => matchedById.get(match.id)
        ?? { operation: snapshot.byId.get(match.id)!, similarity: match.similarity }),
        considered: response.considered, durationMs: performance.now() - started };
    }
    catch (error) {
      // An obsolete owner must not dispose the replacement's shared installation.
      if (active === request || !(signal.aborted || (error as Error)?.name === "AbortError")) reset(current);
      throw error;
    }
    finally
    {
      signal.removeEventListener("abort", cancel);
      if (active === request) active = undefined;
    }
  };
  return Object.assign(evaluate, {
    invalidate(revision: string) {
      if (session && !active && session.revision !== revision) reset(session);
    },
    dispose() { if (session) reset(session); active = undefined; } });
}

export const evaluateOperationsAsync = createOperationMatchingEvaluator();
import.meta.hot?.dispose(evaluateOperationsAsync.dispose);
