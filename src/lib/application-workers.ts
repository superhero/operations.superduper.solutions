// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { StorageReport } from "./storage-metrics-types.d.ts";

const dedicated = new Set<Worker>();

/** Register app-owned workers after construction; release them when their owner terminates them. */
export function trackApplicationWorker(worker: Worker): () => void
{
  dedicated.add(worker);
  return () => { dedicated.delete(worker); };
}

/** This tab's managed execution contexts, not browser processes or hardware capacity. */
export function applicationExecutionMetrics(): StorageReport["execution"]
{
  const page = typeof window !== "undefined";
  return { threads: page ? 1 + dedicated.size : null, dedicatedWorkers: page ? dedicated.size : null };
}
