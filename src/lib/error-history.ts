// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import ErrorHistoryWorker from "./error-history.worker.ts?worker&inline";
import { createWorkerClient } from "./worker-rpc.ts";
import { subscribeApplicationErrors } from "./error-diagnostics.ts";
import { installRuntimeErrorCapture } from "./error-capture.ts";
import { errorHistoryLimit, errorHistoryPageSize, type ErrorDiagnostic, type ErrorHistoryPage, type ErrorHistoryRecord, type ErrorOccurrence } from "./error-history-types.ts";

export type ErrorHistoryState = {
  phase: "idle" | "loading" | "ready" | "unavailable";
  entries: ErrorHistoryRecord[];
  total: number;
  offset: number;
  error: string | null;
  queued: number;
  dropped: number;
  unconfirmed: number;
};

const listeners = new Set<(value: ErrorHistoryState) => void>();
const pending = new Map<string, ErrorOccurrence>();
const queueLimit = 64;
const batchSize = 16;
const responseTimeout = 5_000;
let state: ErrorHistoryState = { phase: "idle", entries: [], total: 0, offset: 0, error: null, queued: 0, dropped: 0, unconfirmed: 0 };
let client: ReturnType<typeof createWorkerClient> | undefined;
let channel: BroadcastChannel | undefined;
let unsubscribeErrors: (() => void) | undefined;
let removeRuntimeCapture: (() => void) | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let started = false;
let suspended = false;
let busy = false;
let readPending = false;
let preferRead = false;
let generation = 0;
let activeBatch: ErrorOccurrence[] = [];

function publish(): void {
  state = { ...state, queued: pending.size };
  for (const listener of listeners) {
    try { listener(state); } catch { /* A history view must not break recording. */ }
  }
}

function enqueue(diagnostic: ErrorDiagnostic): void {
  const now = Date.now();
  const previous = pending.get(diagnostic.identity);
  if (previous) {
    previous.lastSeen = Math.max(previous.lastSeen, now);
    previous.occurrences++;
  } else if (pending.size < queueLimit) {
    pending.set(diagnostic.identity, { ...diagnostic, firstSeen: now, lastSeen: now, occurrences: 1 });
  } else {
    state = { ...state, dropped: state.dropped + 1 };
  }
  publish();
  schedule();
}

function schedule(): void {
  if (!started || suspended || busy || scheduled !== undefined || state.phase === "unavailable") return;
  if (!pending.size && !(readPending && listeners.size)) return;
  scheduled = setTimeout(() => { scheduled = undefined; void run(); }, 25);
}

async function request<T>(method: string, args: unknown[]): Promise<T> {
  client ??= createWorkerClient(() => {
    const worker = new ErrorHistoryWorker({ name: "operations-error-history" });
    const currentGeneration = generation;
    worker.addEventListener("error", event => {
      // Only the recorder's own failure is contained here; application failures
      // retain their normal console and interface reporting.
      event.preventDefault();
      if (currentGeneration === generation) unavailable(event.message || "The error-history worker stopped unexpectedly.");
    });
    worker.addEventListener("messageerror", () => {
      if (currentGeneration === generation) unavailable("Could not read the error-history worker's response.");
    });
    return worker;
  }, { reportErrors: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.call<T>(method, args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The error-history worker did not respond within 5 seconds.")), responseTimeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(): Promise<void> {
  if (!started || suspended || busy || state.phase === "unavailable") return;
  busy = true;
  const currentGeneration = generation;
  const offset = state.offset;
  // Keep an open view current even when fresh errors continuously fill the queue.
  activeBatch = preferRead && readPending && listeners.size ? [] : [...pending.values()].slice(0, batchSize);
  for (const entry of activeBatch) pending.delete(entry.identity);
  const batch = activeBatch;
  if (state.phase === "idle") state = { ...state, phase: "loading" };
  publish();
  try {
    if (batch.length) {
      await request<void>("recordErrors", [batch]);
      if (currentGeneration !== generation) return;
      readPending = true;
      preferRead = true;
      try { channel?.postMessage("updated"); } catch { /* Focus/open also refresh the view. */ }
    } else {
      readPending = false;
      preferRead = false;
      const page = await request<ErrorHistoryPage>("readErrors", [offset, errorHistoryPageSize]);
      if (currentGeneration !== generation) return;
      if (offset === state.offset) {
        const lastOffset = Math.max(0, Math.ceil(page.total / errorHistoryPageSize) - 1) * errorHistoryPageSize;
        if (offset > lastOffset) {
          state = { ...state, offset: lastOffset };
          readPending = true;
        } else state = { ...state, entries: page.entries, total: page.total };
      }
    }
    state = { ...state, phase: "ready", error: null };
  } catch (error) {
    if (currentGeneration !== generation) return;
    unavailable(error instanceof Error ? error.message : "Error history is unavailable.");
  } finally {
    if (currentGeneration === generation) {
      activeBatch = [];
      busy = false;
      publish();
      schedule();
    }
  }
}

function unavailable(message: string): void {
  // A lost acknowledgement may follow a committed transaction. Do not replay it.
  state = { ...state, phase: "unavailable", error: message,
    unconfirmed: state.unconfirmed + activeBatch.reduce((sum, entry) => sum + entry.occurrences, 0) };
  generation++;
  clearTimeout(scheduled);
  scheduled = undefined;
  activeBatch = [];
  busy = false;
  client?.dispose(true);
  client = undefined;
  publish();
}

function invalidate(): void {
  if (!listeners.size) return;
  readPending = true;
  schedule();
}

function suspend(): void {
  suspended = true;
  generation++;
  clearTimeout(scheduled);
  scheduled = undefined;
  state = { ...state, unconfirmed: state.unconfirmed + activeBatch.reduce((sum, entry) => sum + entry.occurrences, 0) };
  activeBatch = [];
  client?.dispose(true);
  client = undefined;
  busy = false;
  publish();
}

function resume(): void {
  suspended = false;
  readPending = true;
  schedule();
}

/** Recording starts independently of the slower resource-measurement loop. */
export function startErrorHistory(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  suspended = false;
  unsubscribeErrors = subscribeApplicationErrors(enqueue);
  removeRuntimeCapture = installRuntimeErrorCapture(window);
  try {
    channel = new BroadcastChannel("operations-error-history");
    channel.onmessage = event => { if (event.data === "updated") invalidate(); };
  } catch { /* The local recorder works without cross-tab notifications. */ }
  window.addEventListener("focus", invalidate);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  schedule();
}

export function subscribeErrorHistory(listener: (value: ErrorHistoryState) => void): () => void {
  startErrorHistory();
  listeners.add(listener);
  try { listener(state); } catch { /* Isolate views from the recorder. */ }
  invalidate();
  return () => { listeners.delete(listener); };
}

export function showErrorHistoryPage(offset: number): void {
  state = { ...state, offset: Math.max(0, Math.min(errorHistoryLimit - errorHistoryPageSize, Math.floor(offset / errorHistoryPageSize) * errorHistoryPageSize)) };
  publish();
  invalidate();
}

export function retryErrorHistory(): void {
  if (!started || suspended || busy) return;
  state = { ...state, phase: "loading", error: null };
  readPending = true;
  publish();
  schedule();
}

export function stopErrorHistory(): void {
  if (!started) return;
  suspend();
  started = false;
  unsubscribeErrors?.();
  removeRuntimeCapture?.();
  unsubscribeErrors = removeRuntimeCapture = undefined;
  channel?.close();
  channel = undefined;
  window.removeEventListener("focus", invalidate);
  window.removeEventListener("pagehide", suspend);
  window.removeEventListener("pageshow", resume);
  listeners.clear();
  pending.clear();
}

import.meta.hot?.dispose(stopErrorHistory);
