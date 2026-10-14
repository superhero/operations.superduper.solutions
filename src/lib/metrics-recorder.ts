// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import MetricsWorker from "./metrics-recorder.worker.ts?worker&inline";
import { collectPageMemory } from "./page-memory.ts";
import { collectWindowMetrics } from "./storage-metrics.ts";
import { logger } from "./logger.ts";
import { reportApplicationError } from "./error-diagnostics.ts";
import { trackApplicationWorker, applicationExecutionMetrics } from "./application-workers.ts";
import { startProcessingMetrics, stopProcessingMetrics } from "./processing-metrics.ts";
import { readMetricsCache, writeMetricsCache } from "./metrics-cache.ts";
import type { RecorderMessage, RecorderReply, RecorderState } from "./metrics-recorder-types.ts";

let worker: Worker | undefined;
let releaseWorker: (() => void) | undefined;
let lifecycleStarted = false;
let state: RecorderState = { phase: "starting", report: null, pageMemory: null, activeBar: null, bars: [], error: null, historyError: null,
  ...readMetricsCache() };
const listeners = new Set<(value: RecorderState) => void>();
const notify = () => { for (const listener of listeners) listener(state); };

function stop() {
  stopProcessingMetrics();
  worker?.terminate();
  releaseWorker?.();
  releaseWorker = undefined;
  worker = undefined;
  // Keep the last snapshot honest when its own collector is no longer running.
  if (state.report) state = { ...state, report: { ...state.report, execution: applicationExecutionMetrics() } };
  notify();
}

/** Start once independently of whether Settings is open. Heavy work stays in its own worker. */
export function startMetricsRecorder(): void
{
  if (!lifecycleStarted) {
    lifecycleStarted = true;
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", startMetricsRecorder);
  }
  if (worker) return;
  try {
    startProcessingMetrics();
    const current = new MetricsWorker({ name: "operations-metrics-recorder" });
    worker = current;
    releaseWorker = trackApplicationWorker(current, { scope: "metrics-recorder" });
    current.onmessage = (event: MessageEvent<RecorderMessage>) => {
      if (worker !== current) return;
      const message = event.data;
      if (message.type === "diagnostic") {
        reportApplicationError(message.error, { source: "worker", scope: "metrics-recorder", operation: message.operation });
        return;
      }
      if (message.type === "measure") {
        // These APIs are Window-only. Waiting is asynchronous; no scan or Git work happens here.
        void collectPageMemory().then(pageMemory => {
          if (worker === current) current.postMessage({ type: "measured", id: message.id, pageMemory,
            windowMetrics: collectWindowMetrics() } satisfies RecorderReply);
        });
        return;
      }
      if (message.type === "snapshot") {
        const incoming = message.snapshot;
        const measured = incoming.report !== null && incoming.report.collectedAt !== state.report?.collectedAt;
        // Starting/restarting the worker must not blank the last known values.
        // Cached observations are display-only and never seed new samples.
        state = { ...state, ...incoming, report: incoming.report ?? state.report,
          pageMemory: incoming.report ? incoming.pageMemory : state.pageMemory };
        if (measured) writeMetricsCache(state);
      }
      else if (message.type === "history") {
        // IndexedDB's completed history replaces the bounded localStorage preview.
        state = { ...state, bars: message.bars };
        writeMetricsCache(state);
      }
      else if (message.type === "saved") {
        state = { ...state, bars: [...new Map([...state.bars, ...message.bars].map(bar => [bar.start, bar])).values()].sort((a, b) => a.start - b.start) };
        writeMetricsCache(state);
      }
      notify();
    };
    current.onerror = event => {
      if (worker !== current) return;
      state = { ...state, phase: "unavailable", error: event.message || "The background metrics recorder stopped unexpectedly." };
      notify();
      stop();
    };
  } catch (error) {
    stopProcessingMetrics();
    logger.warn("Could not start the background metrics recorder.", error);
    state = { ...state, phase: "unavailable", error: error instanceof Error ? error.message : String(error) };
    notify();
  }
}

export function subscribeMetricsRecorder(listener: (value: RecorderState) => void): () => void
{
  listeners.add(listener);
  listener(state);
  startMetricsRecorder();
  return () => { listeners.delete(listener); };
}

import.meta.hot?.dispose(() => {
  stop();
  window.removeEventListener("pagehide", stop);
  window.removeEventListener("pageshow", startMetricsRecorder);
  listeners.clear();
});
