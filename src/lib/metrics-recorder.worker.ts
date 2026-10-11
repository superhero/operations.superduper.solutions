// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import "./worker-runtime.ts";
import { createPail } from "@visulima/pail/browser";
import { collectStorageReport } from "./storage-metrics.ts";
import { MetricsAggregator } from "./metrics-history.ts";
import { metricsHistoryRepository } from "./metrics-history-repository.ts";
import { metricValues } from "./metrics-series.ts";
import type { MetricsBar } from "./metrics-history.ts";
import type { RecorderMessage, RecorderReply, RecorderSnapshot } from "./metrics-recorder-types.ts";

const log = createPail({ scope: "metrics-recorder" });
const scope = globalThis as unknown as { postMessage: (message: RecorderMessage) => void; onmessage: ((event: MessageEvent<RecorderReply>) => void) | null };
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("operations-metrics-recorder-v1");
let aggregation = new MetricsAggregator();
let leader = false;
let history: MetricsBar[] = [];
let pendingBars: MetricsBar[] = [];
let sequence = 0;
let snapshot: RecorderSnapshot = { phase: "starting", report: null, pageMemory: null, activeBar: null, error: null, historyError: null };
let answer: { id: number; resolve: (value: RecorderReply) => void } | null = null;
let aggregateQueue: Promise<void> = Promise.resolve();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function publish(message: Exclude<RecorderMessage, { type: "measure" }>)
{
  scope.postMessage(message);
  channel?.postMessage(message);
}

function update(patch: Partial<RecorderSnapshot>)
{
  snapshot = { ...snapshot, ...patch };
  publish({ type: "snapshot", snapshot });
}

channel?.addEventListener("message", event => {
  if (event.data?.type === "hello" && leader) {
    channel.postMessage({ type: "history", bars: history });
    channel.postMessage({ type: "snapshot", snapshot });
    channel.postMessage({ type: "pending-bars", bars: pendingBars });
  } else if (!leader && event.data?.type === "pending-bars") {
    pendingBars = event.data.bars;
  } else if (!leader && ["history", "snapshot", "saved"].includes(event.data?.type)) {
    const message = event.data as RecorderMessage;
    if (message.type === "snapshot") snapshot = message.snapshot;
    if (message.type === "history") history = message.bars;
    if (message.type === "saved") {
      history = [...new Map([...history, ...message.bars].map(bar => [bar.start, bar])).values()].sort((a, b) => a.start - b.start);
      pendingBars = pendingBars.filter(bar => !message.bars.some(saved => saved.start === bar.start));
    }
    scope.postMessage(message);
  }
});
scope.onmessage = event => {
  if (event.data?.type === "measured" && answer?.id === event.data.id) {
    answer.resolve(event.data);
    answer = null;
  }
};

async function measure(): Promise<RecorderReply>
{
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<RecorderReply>((resolve, reject) => {
      const id = ++sequence;
      answer = { id, resolve };
      // The native request has its own 30-second bound; a suspended page may not reply.
      timeout = setTimeout(() => reject(new Error("The page did not respond to the memory measurement request.")), 40000);
      scope.postMessage({ type: "measure", id });
    });
  } finally { clearTimeout(timeout); answer = null; }
}

async function saveCompleted(bars: MetricsBar[])
{
  pendingBars.push(...bars);
  if (!pendingBars.length) return;
  pendingBars = [...new Map(pendingBars.map(bar => [bar.start, bar])).values()].sort((a, b) => a.start - b.start);
  channel?.postMessage({ type: "pending-bars", bars: pendingBars });
  try {
    await metricsHistoryRepository.save(pendingBars);
    const saved = pendingBars;
    pendingBars = [];
    history = [...new Map([...history, ...saved].map(bar => [bar.start, bar])).values()].sort((a, b) => a.start - b.start);
    publish({ type: "saved", bars: saved });
    if (snapshot.historyError) update({ historyError: null });
  } catch (error) {
    const message = `Could not save metric history: ${errorMessage(error)}`;
    if (snapshot.historyError !== message) log.warn(message);
    update({ historyError: message });
  }
}

function aggregate(task: () => Promise<void>): Promise<void>
{
  aggregateQueue = aggregateQueue.catch(() => {}).then(task);
  return aggregateQueue;
}

function scheduleMinute()
{
  setTimeout(() => {
    void aggregate(async () => {
      const completed = aggregation.flush(Date.now());
      update({ activeBar: aggregation.activeBar() });
      await saveCompleted(completed);
    }).catch(error => update({ historyError: errorMessage(error) })).finally(scheduleMinute);
  }, 60000 - Date.now() % 60000);
}

async function record()
{
  leader = true;
  try { history = await metricsHistoryRepository.load(); publish({ type: "history", bars: history }); }
  catch (error) { update({ historyError: `Could not read metric history: ${errorMessage(error)}` }); }
  // Other open tabs keep only the live aggregate in RAM, allowing ownership to
  // move without losing its open/high/low/count or persisting detailed samples.
  const live = snapshot.activeBar;
  aggregation = new MetricsAggregator(live && !history.some(bar => bar.start === live.start) ? live : null,
    snapshot.report?.collectedAt);
  await aggregate(async () => {
    const completed = aggregation.flush(Date.now());
    update({ activeBar: aggregation.activeBar() });
    await saveCompleted(completed);
  });
  scheduleMinute();
  for (;;) {
    const started = Date.now();
    let interval = 1000;
    try {
      update({ phase: "measuring", error: null });
      const measurement = await measure();
      // Every remaining counter is collected AFTER the page-memory measurement settles.
      update({ phase: "collecting" });
      const report = await collectStorageReport(measurement.windowMetrics);
      await aggregate(async () => {
        const completed = aggregation.add({ timestamp: report.collectedAt, values: metricValues(report, measurement.pageMemory) });
        update({ phase: "waiting", report, pageMemory: measurement.pageMemory, activeBar: aggregation.activeBar() });
        await saveCompleted(completed);
      });
      // Unsupported/failed native APIs must not turn this into a busy collection loop.
      if (measurement.pageMemory.total === null) interval = 30000;
    } catch (error) {
      const message = errorMessage(error);
      log.warn(message);
      update({ phase: "waiting", error: message });
      interval = 30000;
    }
    await delay(Math.max(0, interval - (Date.now() - started)));
  }
}

// A single recorder per origin prevents duplicate Git candles across app tabs.
// A waiting dedicated worker takes over automatically when the owning tab closes.
if (navigator.locks && channel) {
  channel.postMessage({ type: "hello" });
  void navigator.locks.request("operations-metrics-recorder-v1", record).catch(error => {
    update({ phase: "unavailable", error: errorMessage(error) });
  });
} else {
  update({ phase: "unavailable", error: "Background recording requires browser locks and broadcast channels." });
}
