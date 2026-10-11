// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { metricValues, metricSeries } from "./lib/metrics-series.ts";

const missingPage = () => ({ total: null, groups: [], unavailable: "Not supported", error: null });
const missingReport = () => ({
  collectedAt: Date.UTC(2026, 0, 1),
  execution: { threads: null, dedicatedWorkers: null },
  processing: { longTasks: null, longTaskTime: null, blockingTime: null, longestTask: null, interval: null, error: "Unavailable" },
  memory: { used: null, allocated: null, limit: null, utilization: null, error: null },
  browser: { usage: null, quota: null, remaining: null, utilization: null, persisted: null, breakdown: null,
    estimateError: null, persistenceError: null, localStorage: { bytes: null, error: null } },
  indexedDB: { available: false, enumeration: "unavailable", databases: [], error: null },
  repositories: { items: [], error: "Unavailable" },
});
const database = (name, store, records) => ({ name, version: 1, error: null,
  stores: [{ name: store, records, keyPath: null, autoIncrement: false, indexes: [] }] });
const bar = keys => ({ start: 0, end: 900_000,
  metrics: Object.fromEntries(keys.map(key => [key, { open: 1, high: 1, low: 1, close: 1, count: 1 }])) });

Then("metric tree paths group resources and preserve encoded entity names", function () {
  const report = missingReport();
  report.repositories = { error: null, items: [
    { id: "workflow.1", name: "Orders", repositoryPath: "/one", metrics: null, error: null },
    { id: "workflow.2", name: "Orders", repositoryPath: "/two", metrics: null, error: null },
  ] };
  const expected = {
    "application.total": ["Memory", "Application", "Total"],
    "application.category.DOM%20%C2%B7%20Shared": ["Memory", "Application", "DOM · Shared"],
    "heap.used": ["Memory", "JavaScript heap", "Used"],
    "processing.longTasks": ["Processing", "Long tasks"],
    "execution.threads": ["Processing", "Threads"],
    "storage.localStorage": ["Storage", "localStorage"],
    "storage.type.caches": ["Storage", "By type", "caches"],
    "database.records": ["Storage", "IndexedDB", "Total records"],
    "database.v1%2Fsettings.app%2Esettings.records": ["Storage", "IndexedDB", "v1/settings", "app.settings", "Records"],
    "database.records.items.records": ["Storage", "IndexedDB", "records", "items", "Records"],
    "repository.workflow%2E1.gitBytes": ["Git filesystem", "Orders (workflow.1)", "Git history"],
    "repository.workflow%2E2.workingTreeBytes": ["Git filesystem", "Orders (workflow.2)", "Working files"],
  };
  const history = bar(Object.keys(expected));
  const before = structuredClone(history);
  assert.deepEqual(Object.fromEntries(metricSeries([history], null, report).map(entry => [entry.key, entry.path])), expected);
  assert.deepEqual(history, before);
  report.repositories.items[1].name = "Invoices";
  assert.deepEqual(metricSeries([history], null, report).find(entry => entry.key === "repository.workflow%2E1.gitBytes").path,
    ["Git filesystem", "Orders", "Git history"]);
});

Then("metric observations retain valid byte, ratio, category, and processing values", function () {
  const report = missingReport();
  report.execution = { threads: 3, dedicatedWorkers: 2 };
  report.processing = { longTasks: 2, longTaskTime: 180.25, blockingTime: 80.25, longestTask: 100.25, interval: 1000, error: null };
  Object.assign(report.memory, { used: 2048, allocated: 4096, limit: 8192, utilization: 0.5 });
  Object.assign(report.browser, { usage: 512, quota: 2048, remaining: 1536, utilization: 0.25, persisted: false,
    breakdown: [{ name: "indexed DB", bytes: 512 }], localStorage: { bytes: 0, error: null } });
  const page = { total: 640, groups: [{ label: "DOM", bytes: 128 }, { label: "JavaScript", bytes: 512 },
    { label: "Other", bytes: 0 }], unavailable: null, error: null };
  assert.deepEqual(metricValues(report, page), {
    "application.total": 640, "application.category.DOM": 128,
    "execution.threads": 3, "execution.dedicatedWorkers": 2,
    "processing.longTasks": 2, "processing.longTaskTime": 180.25, "processing.blockingTime": 80.25, "processing.longestTask": 100.25,
    "application.category.JavaScript": 512, "application.category.Other": 0,
    "heap.used": 2048, "heap.allocated": 4096, "heap.limit": 8192, "heap.utilization": 0.5,
    "storage.usage": 512, "storage.quota": 2048, "storage.remaining": 1536,
    "storage.localStorage": 0, "storage.type.indexed%20DB": 512,
  });
});

Then("unavailable and invalid metric observations remain absent", function () {
  const report = missingReport();
  assert.deepEqual(metricValues(report, missingPage()), {});
  const legacyReport = { ...report, execution: { mainThread: 1, dedicatedWorkers: 0 } };
  delete legacyReport.processing;
  assert.deepEqual(metricValues(legacyReport, missingPage()), { "execution.dedicatedWorkers": 0 });
  report.processing = { longTasks: 0, longTaskTime: 0, blockingTime: 0, longestTask: 0, interval: 1000, error: null };
  assert.deepEqual(metricValues(report, missingPage()), {
    "processing.longTasks": 0, "processing.longTaskTime": 0, "processing.blockingTime": 0, "processing.longestTask": 0,
  });
  Object.assign(report.processing, { longTasks: -1, longTaskTime: NaN, blockingTime: Infinity, longestTask: undefined });
  Object.assign(report.memory, { used: NaN, allocated: Infinity, limit: -1, utilization: undefined });
  Object.assign(report.browser, { usage: "512", quota: -Infinity, remaining: NaN, utilization: null,
    breakdown: [{ name: "invalid", bytes: -1 }], localStorage: { bytes: -1, error: null } });
  assert.deepEqual(metricValues(report, { ...missingPage(), total: Infinity,
    groups: [{ label: "invalid", bytes: NaN }, { label: "negative", bytes: -1 }] }), {});

  report.indexedDB = { available: true, enumeration: "complete", error: null,
    databases: [database("readable", "items", 0), { ...database("failed", "items", 999), error: "Could not count" }] };
  const values = metricValues(report, missingPage());
  assert.equal(values["database.readable.items.records"], 0);
  assert.equal(Object.hasOwn(values, "database.records"), false, "A partial count must not pretend to be the total");
  assert.equal(Object.hasOwn(values, "database.failed.items.records"), false);
  report.indexedDB.enumeration = "unavailable";
  assert.deepEqual(metricValues(report, missingPage()), {});
});

Then("metric observations keep dotted database and store names distinct", function () {
  const report = missingReport();
  report.indexedDB = { available: true, enumeration: "complete", error: null,
    databases: [database("a.b", "c", 11), database("a", "b.c", 22)] };
  const values = metricValues(report, missingPage());
  assert.equal(values["database.a%2Eb.c.records"], 11);
  assert.equal(values["database.a.b%2Ec.records"], 22);
  assert.equal(values["database.records"], 33);
  assert.equal(Object.hasOwn(values, "database.a.b.c.records"), false);
});

Then("metric series combine history and live observations with readable units", function () {
  const history = bar(["heap.used", "heap.utilization", "database.a%2Eb.c.records", "repository.workflow%2E1.repositoryBytes", "execution.mainThread"]);
  const active = bar(["heap.used", "application.total", "application.category.DOM%20%2B%20Shared",
    "storage.type.indexed%20DB", "storage.persisted", "execution.threads", "execution.dedicatedWorkers",
    "processing.longTasks", "processing.longTaskTime", "processing.blockingTime", "processing.longestTask"]);
  const series = metricSeries([history], active);
  assert.equal(series[0].key, "application.total");
  assert.equal(series.length, 13, "Shared series appear once, and retired counters and structural values are omitted");
  assert.ok(Object.hasOwn(history.metrics, "execution.mainThread"), "Selecting series preserves legacy history");
  const labels = Object.fromEntries(series.map(({ key, label, unit }) => [key, { label, unit }]));
  assert.deepEqual(labels, {
    "application.total": { label: "Application memory · Total", unit: "bytes" },
    "execution.threads": { label: "Processing · Threads", unit: "count" },
    "execution.dedicatedWorkers": { label: "Processing · Worker threads", unit: "count" },
    "processing.longTasks": { label: "Processing · Long tasks", unit: "count" },
    "processing.longTaskTime": { label: "Processing · Long-task time", unit: "ms" },
    "processing.blockingTime": { label: "Processing · Blocking time", unit: "ms" },
    "processing.longestTask": { label: "Processing · Longest task", unit: "ms" },
    "application.category.DOM%20%2B%20Shared": { label: "Application memory · DOM + Shared", unit: "bytes" },
    "database.a%2Eb.c.records": { label: "database · a.b · c · records", unit: "count" },
    "heap.used": { label: "JavaScript heap · Used", unit: "bytes" },
    "heap.utilization": { label: "JavaScript heap · Utilization", unit: "ratio" },
    "repository.workflow%2E1.repositoryBytes": { label: "repository · workflow.1 · repositoryBytes", unit: "bytes" },
    "storage.type.indexed%20DB": { label: "Browser storage · indexed DB", unit: "bytes" },
  });
  assert.deepEqual(metricSeries([], null), []);
});

Then("storage utilization stays in the dashboard report without becoming a history choice", function () {
  const report = missingReport();
  Object.assign(report.browser, { usage: 512, quota: 2048, remaining: 1536, utilization: 0.25 });
  const history = bar(["storage.usage", "storage.utilization", "heap.utilization"]);
  const active = bar(["storage.utilization"]);
  const before = structuredClone({ report, history, active });
  const values = metricValues(report, missingPage());
  assert.equal(values["storage.usage"], 512);
  assert.equal(Object.hasOwn(values, "storage.utilization"), false);
  assert.deepEqual(metricSeries([history], active, report).map(series => series.key), ["heap.utilization", "storage.usage"]);
  assert.equal(report.browser.utilization, 0.25, "The dashboard retains its latest storage ratio");
  assert.deepEqual({ report, history, active }, before, "Retiring a derived chart choice leaves recorded history intact");
});

Then("storage breakdowns matching total usage throughout history share its chart choice", function () {
  const type = "storage.type.indexed%20DB";
  const retained = ["storage.usage", "storage.localStorage", "heap.used", "application.category.JavaScript"];
  const history = bar([type, ...retained]);
  const active = bar([type, "storage.usage"]);
  for (const key of [type, "storage.usage"]) active.metrics[key] = { open: 3, high: 5, low: 2, close: 4, count: 2 };
  const report = missingReport();
  Object.assign(report.browser, { usage: 4, breakdown: [{ name: "indexed DB", bytes: 4 }] });
  const before = structuredClone({ history, active, report });
  for (const current of [null, report, { ...report, browser: { ...report.browser, usage: null, breakdown: null, estimateError: "Unavailable" } }]) {
    assert.deepEqual(metricSeries([history, bar(["heap.used"])], active, current).map(series => series.key).sort(), retained.sort(),
      "Only a matching storage component is redundant; equal observations from other resources remain distinct");
  }
  assert.deepEqual(metricSeries([], active, report).map(series => series.key), ["storage.usage"],
    "Matching live observations can establish redundancy before the first interval is saved");
  assert.deepEqual({ history, active, report }, before, "Combining redundant chart choices must not erase their samples");
});

Then("distinct or incompletely observed storage breakdowns keep their own chart choices", function () {
  const type = "storage.type.indexedDB";
  const expected = [type, "storage.usage"].sort();
  const paired = () => bar(expected);
  const report = missingReport();
  Object.assign(report.browser, { usage: 1, breakdown: [{ name: "indexedDB", bytes: 1 }] });
  const assertRetained = (history, active, current, reason) => {
    const before = structuredClone({ history, active, current });
    assert.deepEqual(metricSeries(history, active, current).map(series => series.key).sort(), expected, reason);
    assert.deepEqual({ history, active, current }, before);
  };
  for (const field of ["open", "high", "low", "close", "count"]) {
    const different = paired();
    different.metrics[type][field] = 2;
    assertRetained([different], paired(), report, `A different historical ${field} prevents combining the series`);
    assertRetained([paired()], different, report, `A different live ${field} prevents combining the series`);
  }
  for (const missing of [type, "storage.usage"]) {
    const incomplete = paired();
    delete incomplete.metrics[missing];
    assertRetained([incomplete], paired(), report, `Missing historical ${missing} is not evidence of equivalence`);
    assertRetained([paired()], incomplete, report, `Missing live ${missing} is not evidence of equivalence`);
  }
  assertRetained([bar([type]), bar(["storage.usage"])], null, report,
    "Separate observations without any paired interval cannot establish equivalence");
  for (const browser of [
    { ...report.browser, breakdown: [{ name: "indexedDB", bytes: 0 }] },
    { ...report.browser, usage: 2 },
    { ...report.browser, breakdown: [] },
    { ...report.browser, breakdown: null },
  ]) assertRetained([paired()], paired(), { ...report, browser },
    "A successful latest estimate must still confirm that the component equals total usage");
});

Then("retired metric keys disappear without erasing supported unavailable history", function () {
  const history = bar(["execution.mainThread", "execution.threads", "processing.interval", "processing.longTasks",
    "heap.used", "heap.retired", "database.readable.retired", "repository.workflow%2E1.retired", "retired.metric"]);
  const active = bar(["execution.mainThread", "storage.quota", "application.category.DOM", "storage.type.indexed%20DB"]);
  const report = missingReport();
  const before = structuredClone({ history, active, report });
  const expected = ["execution.threads", "processing.longTasks", "heap.used", "storage.quota",
    "application.category.DOM", "storage.type.indexed%20DB"].sort();
  assert.deepEqual(metricValues(report, missingPage()), {});
  for (const current of [null, report]) {
    assert.deepEqual(metricSeries([history], active, current).map(series => series.key).sort(), expected);
  }
  assert.deepEqual({ history, active, report }, before, "Hiding retired choices must leave recorded bars unchanged");
});

Then("complete inventories remove deleted entities while preserving encoded metric identities", function () {
  const report = missingReport();
  report.indexedDB = { available: true, enumeration: "complete", error: null,
    databases: [database("a.b", "c", 11), database("a", "b.c", 22)] };
  report.repositories = { items: [], error: null };
  const retained = ["database.records", "database.a%2Eb.c.records", "database.a.b%2Ec.records"];
  const history = bar([...retained, "database.a%2Eb.removed%2Estore.records", "database.a.b.records",
    "database.legacy%2Edatabase.items.records", "repository.removed%2Eworkflow.repositoryBytes",
    "repository.removed%2Eworkflow.workflowBytes"]);
  const active = bar(["database.a%2Eb.c.records", "database.legacy%2Edatabase.other.records", "repository.removed%2Eworkflow.gitBytes"]);
  const before = structuredClone({ history, active, report });
  assert.deepEqual(metricSeries([history], active, report).map(series => series.key).sort(), retained.sort());
  assert.deepEqual({ history, active, report }, before, "Inventory filtering must not rewrite saved or active bars");
});

Then("incomplete or failed inventories preserve entity history", function () {
  const keys = ["database.legacy%2Edatabase.old%2Estore.records", "repository.removed%2Eworkflow.repositoryBytes"];
  const history = bar(keys);
  const active = bar(["database.legacy%2Edatabase.other.records", "repository.removed%2Eworkflow.gitBytes"]);
  const expected = [...keys, ...Object.keys(active.metrics)].sort();
  const before = structuredClone({ history, active });
  const inventories = [
    { available: false, enumeration: "unavailable", error: null, databases: [] },
    { available: true, enumeration: "known", error: null, databases: [] },
    { available: false, enumeration: "complete", error: null, databases: [] },
    { available: true, enumeration: "complete", error: "Enumeration failed", databases: [] },
  ];
  for (const indexedDB of inventories) {
    const report = { ...missingReport(), indexedDB };
    const originalReport = structuredClone(report);
    assert.deepEqual(metricSeries([history], active, report).map(series => series.key).sort(), expected,
      `An ${indexedDB.enumeration} inventory with availability ${indexedDB.available} and error ${indexedDB.error} cannot prove deletion`);
    assert.deepEqual(report, originalReport);
  }
  assert.deepEqual(metricSeries([history], active).map(series => series.key).sort(), expected);
  assert.deepEqual({ history, active }, before);
});

Then("temporarily unreadable databases and repositories retain their metric history", function () {
  const report = missingReport();
  report.indexedDB = { available: true, enumeration: "complete", error: null,
    databases: [{ ...database("a.b", "c.d", 0), stores: [], error: "Cannot inspect database" }] };
  report.repositories = { error: null, items: [{ id: "workflow.1", name: "Workflow one",
    repositoryPath: "/workflows/workflow.1", metrics: null, error: "Cannot read repository" }] };
  const retained = ["database.a%2Eb.c%2Ed.records", "repository.workflow%2E1.repositoryBytes",
    "repository.workflow%2E1.workingTreeBytes"];
  const history = bar([...retained, "database.deleted.items.records", "repository.deleted.gitBytes"]);
  const active = bar(["database.a%2Eb.other.records", "repository.workflow%2E1.gitBytes"]);
  const before = structuredClone({ history, active, report });
  assert.deepEqual(metricSeries([history], active, report).map(series => series.key).sort(),
    [...retained, ...Object.keys(active.metrics)].sort());
  assert.deepEqual({ history, active, report }, before);
});

Then("structural inventory values are neither recorded nor selectable as resource history", function () {
  const report = missingReport();
  report.browser.persisted = true;
  const currentDatabase = database("a.b", "c.d", 4);
  currentDatabase.version = 7;
  currentDatabase.stores[0].indexes = [{ name: "by_name", keyPath: "name", unique: false, multiEntry: false }];
  currentDatabase.stores.push(database("a.b", "other", 2).stores[0]);
  report.indexedDB = { available: true, enumeration: "complete", error: null, databases: [currentDatabase] };
  report.repositories = { error: null, items: [{ id: "workflow.1", name: "Workflow one",
    repositoryPath: "/workflows/workflow.1", error: null, metrics: {
      repositoryBytes: 5120, gitBytes: 4096, workingTreeBytes: 1024,
      branch: "main", head: "saved-revision", branches: ["main", "draft"], tags: ["v1"],
      remotes: [{ name: "origin", url: "https://example.invalid/workflow.git" }],
      trackedFiles: ["workflow.json", "notes.txt"], commitCount: 17,
      status: { clean: false, modified: 2, staged: 1, untracked: 3, deleted: 1 },
      latest: null, recent: [], activity: [], workflowFile: { bytes: 768, mtimeMs: 0, ctimeMs: 0 },
    } }] };
  const resources = {
    "database.records": 6, "database.a%2Eb.c%2Ed.records": 4, "database.a%2Eb.other.records": 2,
    "repository.workflow%2E1.repositoryBytes": 5120, "repository.workflow%2E1.gitBytes": 4096,
    "repository.workflow%2E1.workingTreeBytes": 1024, "repository.workflow%2E1.workflowBytes": 768,
  };
  const structural = ["database.count", "database.a%2Eb.version", "database.a%2Eb.stores",
    "database.a%2Eb.c%2Ed.indexes", "database.a%2Eb.other.indexes", "repository.count", "storage.persisted",
    ...["commitCount", "branches", "tags", "remotes", "trackedFiles", "modified", "staged", "untracked", "deleted"]
      .map(key => `repository.workflow%2E1.${key}`)];
  const history = bar([...Object.keys(resources), ...structural]);
  const active = bar(structural);
  const before = structuredClone({ report, history, active });
  assert.deepEqual(metricValues(report, missingPage()), resources, "Populated inventory fields must not become samples");
  for (const current of [null, report]) {
    assert.deepEqual(metricSeries([history], active, current).map(series => series.key).sort(), Object.keys(resources).sort(),
      "Previously recorded inventory fields must not appear as chart choices");
  }
  assert.deepEqual({ report, history, active }, before, "Filtering preserves the report and all historical samples");
});
