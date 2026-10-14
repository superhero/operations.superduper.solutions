// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { StorageReport } from "./storage-metrics-types.d.ts";
import { reportApplicationError } from "./error-diagnostics.ts";

const dedicated = new Set<Worker>();

/** Register app-owned workers after construction; release them when their owner terminates them. */
export function trackApplicationWorker(worker: Worker, options: { reportErrors?: boolean; scope?: string } = {}): () => void
{
  dedicated.add(worker);
  const error = (event: ErrorEvent) => reportApplicationError(event.error ?? {
    name: "WorkerError", message: event.message || "The background worker stopped unexpectedly.",
  }, { source: "worker", scope: options.scope, filename: event.filename, line: event.lineno, column: event.colno });
  const messageError = () => reportApplicationError({ name: "WorkerError", message: "Could not read the background worker's response." },
    { source: "worker", scope: options.scope });
  if (options.reportErrors !== false) {
    worker.addEventListener("error", error);
    worker.addEventListener("messageerror", messageError);
  }
  return () => {
    dedicated.delete(worker);
    if (options.reportErrors !== false) {
      worker.removeEventListener("error", error);
      worker.removeEventListener("messageerror", messageError);
    }
  };
}

/** This tab's managed execution contexts, not browser processes or hardware capacity. */
export function applicationExecutionMetrics(): StorageReport["execution"]
{
  const page = typeof window !== "undefined";
  return { threads: page ? 1 + dedicated.size : null, dedicatedWorkers: page ? dedicated.size : null };
}
