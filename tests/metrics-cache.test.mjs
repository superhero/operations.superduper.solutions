// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { test } from "node:test";
import { metricsCacheKey, readMetricsCache, writeMetricsCache } from "../src/lib/metrics-cache.ts";

const duration = 15 * 60_000;
const now = Date.UTC(2026, 9, 11, 12, 7);
const currentStart = Math.floor(now / duration) * duration;
const maxCharacters = 512 * 1024;

function storage(t)
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map();
  const result = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: result });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    get localStorage() { return globalThis.localStorage; },
  } });
  t.mock.method(Date, "now", () => now);
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
  });
  return result;
}

function bar(start = currentStart - duration, value = 32)
{
  return { start, end: start + duration, metrics: {
    "memory.used": { open: value, high: value + 3, low: value - 2, close: value + 1, count: 8 },
  } };
}

function report(collectedAt = now - 1_000)
{
  const commit = { oid: "abc123", message: "Save workflow", timestamp: 1_791_720_000,
    author: "Test author", committer: "Test committer", parents: [] };
  return {
    collectedAt,
    execution: { threads: 3, dedicatedWorkers: 2 },
    processing: { longTasks: 2, longTaskTime: 180, blockingTime: 80, longestTask: 100, interval: 1_000, error: null },
    memory: { used: 4_096, allocated: 8_192, limit: 16_384, utilization: 0.5, error: null },
    browser: { usage: 12_000, quota: 48_000, remaining: 36_000, utilization: 0.25, persisted: true,
      breakdown: [{ name: "indexedDB", bytes: 11_000 }], estimateError: null, persistenceError: null,
      localStorage: { bytes: 1_000, error: null } },
    indexedDB: { available: true, enumeration: "complete", error: null, databases: [
      { name: "workflows", version: 1, error: null, stores: [
        { name: "documents", records: 2, keyPath: "id", autoIncrement: false,
          indexes: [{ name: "updated", keyPath: ["updatedAt", "id"], unique: false, multiEntry: false }] },
      ] },
    ] },
    repositories: { error: null, items: [{ id: "workflow-1", name: "Example", repositoryPath: "/workflows/example", error: null,
      metrics: { repositoryBytes: 4_096, gitBytes: 3_072, workingTreeBytes: 1_024, branch: "main", head: "abc123",
        branches: ["main"], tags: [], remotes: [{ name: "origin", url: "https://example.test/workflow.git" }],
        trackedFiles: ["workflow.json"], status: { clean: true, modified: 0, staged: 0, untracked: 0, deleted: 0 },
        commitCount: 1, latest: commit, recent: [commit], activity: [{ date: "2026-10-11", count: 1 }],
        workflowFile: { bytes: 1_024, mtimeMs: collectedAt - 1_000, ctimeMs: collectedAt - 2_000 } },
    }] },
  };
}

function snapshot()
{
  return { report: report(), pageMemory: { total: 12_288, groups: [{ label: "JavaScript", bytes: 8_192 },
    { label: "DOM", bytes: 4_096 }], unavailable: null, error: null }, bars: [bar()] };
}

function freeze(value)
{
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("metrics cache round-trips completed history before a live report exists", t => {
  const local = storage(t);
  assert.equal(metricsCacheKey, "v1/metrics/cache");
  assert.equal(readMetricsCache(), null);
  const value = { report: null, pageMemory: null, bars: [bar()] };
  writeMetricsCache(value);
  assert.deepEqual(readMetricsCache(), value);
  assert.equal(JSON.parse(local.getItem(metricsCacheKey)).version, 1);
});

test("metrics cache round-trips a full report and page-memory breakdown without mutating the input", t => {
  storage(t);
  const value = freeze(snapshot());
  const original = structuredClone(value);
  assert.doesNotThrow(() => writeMetricsCache(value));
  assert.deepEqual(readMetricsCache(), original);
  assert.deepEqual(value, original);
  const first = readMetricsCache();
  first.report.indexedDB.databases[0].stores[0].records = 999;
  first.bars[0].metrics["memory.used"].close = 999;
  assert.deepEqual(readMetricsCache(), original, "Readers cannot mutate the stored snapshot through an earlier read.");
});

test("metrics cache retains the newest 96 completed intervals and excludes live or raw samples", t => {
  const local = storage(t);
  const completed = Array.from({ length: 104 }, (_, index) => bar(currentStart - (104 - index) * duration, index + 4));
  const value = freeze({ report: null, pageMemory: null,
    bars: [...completed].reverse().map(entry => ({ ...entry, samples: [{ timestamp: entry.start, value: 1_234 }] }))
      .concat([bar(currentStart), bar(currentStart + duration)]),
    activeBar: bar(currentStart), samples: [{ timestamp: now, values: { "memory.used": 1_234 } }] });
  const original = structuredClone(value);
  writeMetricsCache(value);
  const cached = readMetricsCache();
  assert.deepEqual(cached.bars, completed.slice(-96));
  assert.equal(cached.bars.every(entry => entry.end <= now), true);
  const envelope = JSON.parse(local.getItem(metricsCacheKey));
  assert.equal(Object.hasOwn(envelope, "activeBar"), false);
  assert.equal(Object.hasOwn(envelope, "samples"), false);
  assert.equal(Object.hasOwn(cached, "activeBar"), false);
  assert.equal(Object.hasOwn(cached, "samples"), false);
  assert.deepEqual(value, original);
});

test("an older writer cannot replace a more recent report", t => {
  storage(t);
  const newer = snapshot();
  writeMetricsCache(newer);
  const older = snapshot();
  older.report.collectedAt -= 60_000;
  older.report.memory.used = 16;
  writeMetricsCache(older);
  assert.deepEqual(readMetricsCache().report, newer.report);
});

test("metrics cache ignores invalid JSON, unsupported envelopes, and malformed nested measurements", t => {
  const local = storage(t);
  writeMetricsCache(snapshot());
  const valid = local.getItem(metricsCacheKey);
  const malformed = ["", "{", "null", "[]", "42", JSON.stringify({ version: 2 }), JSON.stringify({ version: 1 })];
  for (const alter of [
    value => { value.version = 2; },
    value => { value.report.execution.threads = "3"; },
    value => { value.report.indexedDB.databases[0].stores[0].indexes = null; },
    value => { value.report.repositories.items[0].metrics.recent = [null]; },
    value => { value.pageMemory.groups[0].bytes = "8192"; },
    value => { value.bars[0].metrics["memory.used"].count = 0; },
    value => { value.bars[0].end++; },
  ]) {
    const value = JSON.parse(valid);
    alter(value);
    malformed.push(JSON.stringify(value));
  }
  for (const value of malformed) {
    local.setItem(metricsCacheKey, value);
    assert.doesNotThrow(() => assert.equal(readMetricsCache(), null));
  }
});

test("metrics cache bounds serialized input and output", t => {
  const local = storage(t);
  writeMetricsCache(snapshot());
  local.setItem(metricsCacheKey, `${" ".repeat(maxCharacters)}${local.getItem(metricsCacheKey)}`);
  assert.equal(readMetricsCache(), null);
  const oversized = snapshot();
  oversized.report.repositories.items[0].name = "x".repeat(maxCharacters);
  local.removeItem(metricsCacheKey);
  assert.doesNotThrow(() => writeMetricsCache(oversized));
  const text = local.getItem(metricsCacheKey);
  assert.equal(text === null || text.length <= maxCharacters, true);
});

test("missing, denied, unreadable, and quota-limited localStorage never break metric collection", t => {
  storage(t);
  const failure = () => { throw new Error("Storage is unavailable"); };
  for (const descriptor of [
    null,
    { get: failure },
    { value: { getItem: failure, setItem: failure } },
    { value: { getItem: () => null, setItem: failure } },
  ]) {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
    else delete globalThis.localStorage;
    assert.doesNotThrow(() => assert.equal(readMetricsCache(), null));
    assert.doesNotThrow(() => writeMetricsCache(snapshot()));
  }
  delete globalThis.window;
  assert.doesNotThrow(() => assert.equal(readMetricsCache(), null));
  assert.doesNotThrow(() => writeMetricsCache(snapshot()));
});

test("cached database inventories preserve partial enumeration and compound or external keys", t => {
  storage(t);
  for (const enumeration of ["known", "unavailable"]) {
    for (const keyPath of [null, ["tenant", "id"]]) {
      const value = snapshot();
      value.report.indexedDB.enumeration = enumeration;
      value.report.indexedDB.databases[0].stores[0].keyPath = keyPath;
      writeMetricsCache(value);
      assert.deepEqual(readMetricsCache(), value);
    }
  }
});

test("cache retains the newest complete candles when earlier candles exceed its byte budget", t => {
  storage(t);
  const oversized = bar(currentStart - 2 * duration);
  oversized.metrics["x".repeat(maxCharacters)] = oversized.metrics["memory.used"];
  writeMetricsCache({ report: null, pageMemory: null, bars: [oversized, bar()] });
  assert.deepEqual(readMetricsCache().bars, [bar()]);
});
