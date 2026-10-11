// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { StorageReport } from "./storage-metrics-types.d.ts";
import type { PageMemoryReport } from "./page-memory.ts";
import type { MetricsBar } from "./metrics-history.ts";

export type MetricSeries = { key: string; label: string; unit: "bytes" | "count" | "ratio" | "ms"; path?: string[] };
const segment = (value: string) => encodeURIComponent(value).replaceAll(".", "%2E");
const definitions: Record<string, [string, MetricSeries["unit"]]> = {
  "application.total": ["Application memory · Total", "bytes"],
  "execution.threads": ["Processing · Threads", "count"],
  "execution.dedicatedWorkers": ["Processing · Worker threads", "count"],
  "processing.longTasks": ["Processing · Long tasks", "count"],
  "processing.longTaskTime": ["Processing · Long-task time", "ms"],
  "processing.blockingTime": ["Processing · Blocking time", "ms"],
  "processing.longestTask": ["Processing · Longest task", "ms"],
  "heap.used": ["JavaScript heap · Used", "bytes"], "heap.allocated": ["JavaScript heap · Allocated", "bytes"],
  "heap.limit": ["JavaScript heap · Limit", "bytes"], "heap.utilization": ["JavaScript heap · Utilization", "ratio"],
  "storage.usage": ["Browser storage · Used", "bytes"], "storage.quota": ["Browser storage · Quota", "bytes"],
  "storage.remaining": ["Browser storage · Remaining", "bytes"],
  "storage.localStorage": ["Browser storage · localStorage", "bytes"],
  "database.records": ["IndexedDB · Records", "count"],
};

/** Resource measurements only; structural inventory and status stay out of candles. */
export function metricValues(report: StorageReport, page: PageMemoryReport): Record<string, number>
{
  const values: Record<string, number> = {};
  const add = (key: string, value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) values[key] = value;
  };
  add("application.total", page.total);
  add("execution.threads", report.execution?.threads);
  add("execution.dedicatedWorkers", report.execution?.dedicatedWorkers);
  for (const key of ["longTasks", "longTaskTime", "blockingTime", "longestTask"] as const) add(`processing.${key}`, report.processing?.[key]);
  for (const group of page.groups) add(`application.category.${segment(group.label)}`, group.bytes);
  for (const key of ["used", "allocated", "limit", "utilization"] as const) add(`heap.${key}`, report.memory[key]);
  for (const key of ["usage", "quota", "remaining"] as const) add(`storage.${key}`, report.browser[key]);
  add("storage.localStorage", report.browser.localStorage.bytes);
  for (const type of report.browser.breakdown ?? []) add(`storage.type.${segment(type.name)}`, type.bytes);
  if (report.indexedDB.available && report.indexedDB.enumeration !== "unavailable") {
    if (report.indexedDB.databases.every(database => !database.error))
      add("database.records", report.indexedDB.databases.reduce((sum, database) => sum + database.stores.reduce((total, store) => total + store.records, 0), 0));
    for (const database of report.indexedDB.databases) {
      const prefix = `database.${segment(database.name)}`;
      if (database.error) continue;
      for (const store of database.stores) {
        add(`${prefix}.${segment(store.name)}.records`, store.records);
      }
    }
  }
  for (const entry of report.repositories.items) {
    const metrics = entry.metrics;
    if (!metrics) continue;
    const prefix = `repository.${segment(entry.id)}`;
    for (const key of ["repositoryBytes", "gitBytes", "workingTreeBytes"] as const) add(`${prefix}.${key}`, metrics[key]);
    add(`${prefix}.workflowBytes`, metrics.workflowFile?.bytes);
  }
  return values;
}

function isCurrentSeries(key: string, report: StorageReport | null): boolean
{
  if (Object.hasOwn(definitions, key)) return true;
  let parts: string[];
  try { parts = key.split(".").map(decodeURIComponent); }
  catch { return false; }
  const [kind, name, field, detail] = parts;
  if (kind === "application") return parts.length === 3 && name === "category";
  if (kind === "storage") return parts.length === 3 && name === "type";
  if (kind === "database")
  {
    if (parts.length !== 4 || detail !== "records") return false;
    const inventory = report?.indexedDB;
    if (!inventory?.available || inventory.enumeration !== "complete" || inventory.error) return true;
    const database = inventory.databases.find(entry => entry.name === name);
    return Boolean(database && (database.error || database.stores.some(store => store.name === field)));
  }
  if (kind === "repository")
  {
    if (parts.length !== 3 || !["repositoryBytes", "gitBytes", "workingTreeBytes", "workflowBytes"].includes(field!)) return false;
    return !report || Boolean(report.repositories.error) || report.repositories.items.some(entry => entry.id === name);
  }
  return false;
}

/** A storage component may mirror the total; unrelated equal counters are still distinct. */
function repeatsStorageTotal(key: string, bars: MetricsBar[], report: StorageReport | null): boolean
{
  if (!key.startsWith("storage.type.")) return false;
  if (report && !report.browser.estimateError && report.browser.usage !== null) {
    const name = decodeURIComponent(key.slice("storage.type.".length));
    if (report.browser.breakdown?.find(type => type.name === name)?.bytes !== report.browser.usage) return false;
  }
  let matched = false;
  for (const bar of bars) {
    const component = bar.metrics[key], total = bar.metrics["storage.usage"];
    if (!component && !total) continue;
    if (!component || !total || (["open", "high", "low", "close", "count"] as const)
      .some(field => component[field] !== total[field])) return false;
    matched = true;
  }
  return matched;
}

function metricPath(key: string, label: string, report: StorageReport | null): string[]
{
  const [kind, name, field] = key.split(".").map(decodeURIComponent);
  const title = label.split(" · ").at(-1)!;
  if (kind === "application") return ["Memory", "Application", name === "total" ? "Total" : field!];
  if (kind === "heap") return ["Memory", "JavaScript heap", title];
  if (kind === "execution" || kind === "processing") return ["Processing", title];
  if (kind === "storage") return name === "type" ? ["Storage", "By type", field!] : ["Storage", title];
  if (kind === "database") return key === "database.records" ? ["Storage", "IndexedDB", "Total records"]
    : ["Storage", "IndexedDB", name!, field!, "Records"];
  // isCurrentSeries already restricted the remaining keys to these repository fields.
  const entry = report?.repositories.items.find(item => item.id === name);
  const uniqueName = entry && report!.repositories.items.filter(item => item.name === entry.name).length === 1;
  const repository = entry ? uniqueName ? entry.name : `${entry.name} (${entry.id})` : name!;
  const titles: Record<string, string> = { repositoryBytes: "Total size", gitBytes: "Git history", workingTreeBytes: "Working files", workflowBytes: "Workflow file" };
  return ["Git filesystem", repository, titles[field!]!];
}

export function metricSeries(bars: MetricsBar[], active: MetricsBar | null, report: StorageReport | null = null): MetricSeries[]
{
  const keys = new Set(bars.flatMap(bar => Object.keys(bar.metrics)));
  if (active) for (const key of Object.keys(active.metrics)) keys.add(key);
  // Keep saved intervals intact, but only offer current counters and entities.
  // Failed or partial inventories do not prove that an entity was deleted.
  const intervals = active ? [...bars, active] : bars;
  return [...keys].filter(key => isCurrentSeries(key, report) && !repeatsStorageTotal(key, intervals, report))
    .sort((a, b) => a === "application.total" ? -1 : b === "application.total" ? 1 : a.localeCompare(b)).map(key => {
    const describe = (label: string, unit: MetricSeries["unit"]): MetricSeries => ({ key, label, unit, path: metricPath(key, label, report) });
    const known = definitions[key];
    if (known) return describe(known[0], known[1]);
    const pieces = key.split(".").map(decodeURIComponent);
    if (key.startsWith("application.category.")) return describe(`Application memory · ${pieces.slice(2).join(".")}`, "bytes");
    if (key.startsWith("storage.type.")) return describe(`Browser storage · ${pieces.slice(2).join(".")}`, "bytes");
    return describe(pieces.join(" · "), /Bytes$/.test(key) ? "bytes" : "count");
  });
}
