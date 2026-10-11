// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type ProcessingMetrics = {
  longTasks: number | null;
  longTaskTime: number | null;
  blockingTime: number | null;
  longestTask: number | null;
  interval: number | null;
  error: string | null;
};

let observer: PerformanceObserver | undefined;
let sessionStarted = 0;
let intervalStarted = 0;
let lastTaskStarted = -Infinity;
let longTasks = 0;
let longTaskTime = 0;
let blockingTime = 0;
let longestTask = 0;
let error: string | null = "Processing measurements have not started.";

function reset(): void
{
  longTasks = 0;
  longTaskTime = 0;
  blockingTime = 0;
  longestTask = 0;
}

function accumulate(entries: PerformanceEntry[]): void
{
  for (const entry of entries)
  {
    const { startTime, duration } = entry;
    if (entry.entryType !== "longtask" || !Number.isFinite(startTime) || !Number.isFinite(duration)
      || duration < 50 || startTime < sessionStarted || startTime <= lastTaskStarted) continue;
    // Keep the watermark across reads: a task spanning a read arrives after it ends.
    lastTaskStarted = startTime;
    longTasks++;
    longTaskTime += duration;
    blockingTime += Math.max(0, duration - 50);
    longestTask = Math.max(longestTask, duration);
  }
}

/** Observe this page's main-thread long tasks without polling or retaining attribution. */
export function startProcessingMetrics(): void
{
  if (observer) return;
  reset();
  lastTaskStarted = -Infinity;
  try
  {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined"
      || !PerformanceObserver.supportedEntryTypes?.includes("longtask"))
    {
      error = "This browser does not support long-task measurements.";
      return;
    }
    sessionStarted = intervalStarted = performance.now();
    const current = new PerformanceObserver(entries => {
      if (observer === current) accumulate(entries.getEntries());
    });
    observer = current;
    current.observe({ type: "longtask" });
    error = null;
  }
  catch (reason)
  {
    stopProcessingMetrics();
    error = reason instanceof Error ? reason.message : String(reason);
  }
}

/** Discard the partial interval when page lifecycle or recorder ownership ends. */
export function stopProcessingMetrics(): void
{
  observer?.disconnect();
  observer = undefined;
  reset();
  error = "Processing measurements are stopped.";
}

/** Read and reset observed task durations, which are elapsed time, not CPU utilization. */
export function collectProcessingMetrics(): ProcessingMetrics
{
  if (observer)
  {
    try
    {
      accumulate(observer.takeRecords());
      const now = performance.now();
      const sample = { longTasks, longTaskTime, blockingTime, longestTask,
        interval: Math.max(0, now - intervalStarted), error: null };
      intervalStarted = now;
      reset();
      return sample;
    }
    catch (reason)
    {
      stopProcessingMetrics();
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  return { longTasks: null, longTaskTime: null, blockingTime: null, longestTask: null, interval: null, error };
}
