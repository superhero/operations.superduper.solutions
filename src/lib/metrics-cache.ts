// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { MetricCandle, MetricsBar } from "./metrics-history.ts";
import type { PageMemoryReport } from "./page-memory.ts";
import type { StorageCommit, StorageReport, WorkflowStorageMetrics } from "./storage-metrics-types.d.ts";

export const metricsCacheKey = "v1/metrics/cache";
export type MetricsCacheData = { report: StorageReport | null; pageMemory: PageMemoryReport | null; bars: MetricsBar[] };

const maxCharacters = 512 * 1024;
const maxBars = 96;
const barDuration = 15 * 60_000;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => number(value) && Number.isSafeInteger(value);
const timestamp = (value: unknown): value is number => integer(value) && Number.isFinite(new Date(value).getTime());
const nullable = <T>(value: unknown, valid: (value: unknown) => value is T): value is T | null => value === null || valid(value);
const array = <T>(value: unknown, valid: (value: unknown) => value is T): value is T[] => Array.isArray(value) && value.every(valid);
const unique = <T>(values: T[], key: (value: T) => unknown): boolean => new Set(values.map(key)).size === values.length;
const numbers = (value: Record<string, unknown>, keys: string[]): boolean => keys.every(key => number(value[key]));
const nullableNumbers = (value: Record<string, unknown>, keys: string[]): boolean => keys.every(key => nullable(value[key], number));

function commit(value: unknown): value is StorageCommit
{
  return object(value) && string(value.oid) && string(value.message) && number(value.timestamp)
    && string(value.author) && string(value.committer) && array(value.parents, string);
}

function repositoryMetrics(value: unknown): value is WorkflowStorageMetrics
{
  return object(value) && numbers(value, ["repositoryBytes", "gitBytes", "workingTreeBytes", "commitCount"])
    && nullable(value.branch, string) && nullable(value.head, string) && array(value.branches, string)
    && array(value.tags, string) && array(value.trackedFiles, string)
    && array(value.remotes, (item): item is WorkflowStorageMetrics["remotes"][number] =>
      object(item) && string(item.name) && string(item.url))
    && object(value.status) && typeof value.status.clean === "boolean"
    && numbers(value.status, ["modified", "staged", "untracked", "deleted"])
    && nullable(value.latest, commit) && array(value.recent, commit)
    && array(value.activity, (item): item is WorkflowStorageMetrics["activity"][number] =>
      object(item) && string(item.date) && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && integer(item.count))
    && unique(value.activity, item => item.date)
    && nullable(value.workflowFile, (item): item is NonNullable<WorkflowStorageMetrics["workflowFile"]> =>
      object(item) && numbers(item, ["bytes", "mtimeMs", "ctimeMs"]));
}

function report(value: unknown): value is StorageReport
{
  return object(value) && timestamp(value.collectedAt)
    && object(value.execution) && nullable(value.execution.threads, integer) && nullable(value.execution.dedicatedWorkers, integer)
    && object(value.processing) && nullableNumbers(value.processing, ["longTasks", "longTaskTime", "blockingTime", "longestTask", "interval"])
    && nullable(value.processing.error, string)
    && object(value.memory) && nullableNumbers(value.memory, ["used", "allocated", "limit", "utilization"]) && nullable(value.memory.error, string)
    && object(value.browser) && nullableNumbers(value.browser, ["usage", "quota", "remaining", "utilization"])
    && (value.browser.persisted === null || typeof value.browser.persisted === "boolean")
    && nullable(value.browser.breakdown, (items): items is NonNullable<StorageReport["browser"]["breakdown"]> =>
      array(items, (item): item is NonNullable<StorageReport["browser"]["breakdown"]>[number] =>
        object(item) && string(item.name) && number(item.bytes)))
    && nullable(value.browser.estimateError, string) && nullable(value.browser.persistenceError, string)
    && object(value.browser.localStorage) && nullable(value.browser.localStorage.bytes, number) && nullable(value.browser.localStorage.error, string)
    && object(value.indexedDB) && typeof value.indexedDB.available === "boolean"
    && (value.indexedDB.enumeration === "complete" || value.indexedDB.enumeration === "known" || value.indexedDB.enumeration === "unavailable")
    && nullable(value.indexedDB.error, string)
    && array(value.indexedDB.databases, (database): database is StorageReport["indexedDB"]["databases"][number] =>
      object(database) && string(database.name) && nullable(database.version, integer) && nullable(database.error, string)
      && array(database.stores, (store): store is StorageReport["indexedDB"]["databases"][number]["stores"][number] =>
        object(store) && string(store.name) && integer(store.records) && typeof store.autoIncrement === "boolean"
        && (store.keyPath === null || string(store.keyPath) || array(store.keyPath, string))
        && array(store.indexes, (index): index is StorageReport["indexedDB"]["databases"][number]["stores"][number]["indexes"][number] =>
          object(index) && string(index.name) && (string(index.keyPath) || array(index.keyPath, string))
          && typeof index.unique === "boolean" && typeof index.multiEntry === "boolean")))
    && unique(value.indexedDB.databases, database => database.name)
    && object(value.repositories) && nullable(value.repositories.error, string)
    && array(value.repositories.items, (entry): entry is StorageReport["repositories"]["items"][number] =>
      object(entry) && string(entry.id) && string(entry.name) && string(entry.repositoryPath)
      && nullable(entry.error, string) && nullable(entry.metrics, repositoryMetrics))
    && unique(value.repositories.items, entry => entry.id);
}

function pageMemory(value: unknown): value is PageMemoryReport
{
  return object(value) && nullable(value.total, number) && nullable(value.unavailable, string) && nullable(value.error, string)
    && array(value.groups, (group): group is PageMemoryReport["groups"][number] => object(group) && string(group.label) && number(group.bytes))
    && unique(value.groups, group => group.label);
}

function candle(value: unknown): value is MetricCandle
{
  return object(value) && number(value.open) && number(value.high) && number(value.low) && number(value.close)
    && integer(value.count) && value.count > 0 && value.low <= Math.min(value.open, value.close)
    && value.high >= Math.max(value.open, value.close) && value.low <= value.high;
}

function bar(value: unknown): value is MetricsBar
{
  return object(value) && timestamp(value.start) && timestamp(value.end) && value.start % barDuration === 0
    && value.end === value.start + barDuration && object(value.metrics)
    && Object.keys(value.metrics).length > 0 && Object.values(value.metrics).every(candle);
}

function completedBars(bars: MetricsBar[]): MetricsBar[]
{
  const now = Date.now();
  return [...new Map(bars.filter(item => item.end <= now).map(item => [item.start, item])).values()]
    .sort((left, right) => left.start - right.start).slice(-maxBars).map(item => ({
      start: item.start, end: item.end,
      metrics: Object.fromEntries(Object.entries(item.metrics).map(([key, value]) => [key, {
        open: value.open, high: value.high, low: value.low, close: value.close, count: value.count,
      }])),
    }));
}

function read(storage: Storage): MetricsCacheData | null
{
  const encoded = storage.getItem(metricsCacheKey);
  if (!encoded || encoded.length > maxCharacters) return null;
  const value: unknown = JSON.parse(encoded);
  if (!object(value) || value.version !== 1 || !nullable(value.report, report) || !nullable(value.pageMemory, pageMemory)
    || !array(value.bars, bar)) return null;
  return { report: value.report, pageMemory: value.pageMemory, bars: completedBars(value.bars) };
}

/** Synchronous, detached startup preview; IndexedDB remains the history authority. */
export function readMetricsCache(): MetricsCacheData | null
{
  try { return typeof window === "undefined" ? null : read(window.localStorage); }
  catch { return null; }
}

/** Call on new measurements or completed history, never on recorder phase changes. */
export function writeMetricsCache(data: MetricsCacheData): void
{
  try
  {
    if (typeof window === "undefined" || !nullable(data.report, report) || !nullable(data.pageMemory, pageMemory) || !array(data.bars, bar)) return;
    const storage = window.localStorage;
    let previous: MetricsCacheData | null = null;
    try { previous = read(storage); } catch { /* A corrupt preview may be replaced. */ }
    if (previous?.report && (!data.report || previous.report.collectedAt > data.report.collectedAt)) return;
    const payload = { version: 1, report: data.report, pageMemory: data.pageMemory, bars: [] as MetricsBar[] };
    let remaining = maxCharacters - JSON.stringify(payload).length;
    if (remaining < 0) return;
    // Keep complete newest bars that fit; never trim a candle or report's inventory.
    for (const item of completedBars(data.bars).reverse())
    {
      const size = JSON.stringify(item).length + (payload.bars.length ? 1 : 0);
      if (size > remaining) break;
      payload.bars.unshift(item);
      remaining -= size;
    }
    storage.setItem(metricsCacheKey, JSON.stringify(payload));
  }
  catch { /* Cache access, serialization, or quota failure must not stop recording. */ }
}
