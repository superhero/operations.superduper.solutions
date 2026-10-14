// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationExecutionMetrics, trackApplicationWorker } from "../src/lib/application-workers.ts";
import { reportStartup, setStartupReporter } from "../src/lib/startup-reporter.ts";
import * as names from "../src/lib/storage-names.ts";
import { additionalBodyField, prepareRequest } from "../src/lib/operation-input.ts";
import { scopeOperationSchema } from "../src/lib/operation-report.ts";
import { metricValues, metricSeries } from "../src/lib/metrics-series.ts";

test("worker accounting distinguishes page contexts and releases workers idempotently", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => original ? Object.defineProperty(globalThis, "window", original) : delete globalThis.window);
  delete globalThis.window;
  assert.deepEqual(applicationExecutionMetrics(), { threads: null, dedicatedWorkers: null });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const release = trackApplicationWorker(new EventTarget());
  assert.deepEqual(applicationExecutionMetrics(), { threads: 2, dedicatedWorkers: 1 });
  release(); release();
  assert.deepEqual(applicationExecutionMetrics(), { threads: 1, dedicatedWorkers: 0 });
});

test("startup reporters can be registered replaced and detached without retaining callbacks", () => {
  const calls = [];
  reportStartup("application");
  setStartupReporter((...args) => calls.push(args));
  reportStartup("schemas", "Checking documents");
  setStartupReporter(undefined);
  reportStartup("canvas");
  assert.deepEqual(calls, [["schemas", "Checking documents"]]);
});

test("storage namespaces separate schema catalogs workflow repositories settings and metrics", () => {
  assert.deepEqual(Object.values(names).filter(value => typeof value === "string").sort(), [
    "v1/catalogs", "v1/catalogs/index", "v1/errors", "v1/metrics", "v1/settings", "v1/workflows", "v1/workflows/index"
  ]);
  assert.equal(names.legacyStorageNames.workflowIndex, "operations-workflow-catalog-v1");
});

test("additional body fields handle open objects missing property maps and invalid type declarations", () => {
  const operation = { id: "custom", method: "POST", path: "/custom", fields: [], bodyRequired: false,
    bodySchema: { type: "object" } };
  const empty = additionalBodyField(operation, "", "string");
  assert.equal(empty.label, "(empty name)");
  assert.equal(empty.required, false);
  assert.deepEqual(prepareRequest(operation, { "body:": "" }, [empty]).body, { "": "" });
  assert.equal(additionalBodyField({ ...operation, bodySchema: { type: "object", additionalProperties: { type: "invalid" } } }, "bad", "string"), undefined);
  assert.equal(additionalBodyField({ ...operation, bodySchema: { type: "object", required: ["needed"] } }, "needed", "string").required, true);
});

test("operation reports reject cyclic external malformed and missing path item references", () => {
  for (const item of [{ $ref: "https://example.test/path" }, { $ref: "#/paths/~q" }, { $ref: "#/paths/~1items" },
    { $ref: "#/components/pathItems/Missing" }, { $ref: "#/components/pathItems/Valid", summary: "Sibling" }]) {
    const document = { openapi: "3.1.0", info: {}, paths: { "/items": item }, components: { pathItems: { Valid: { get: {} } } } };
    assert.throws(() => scopeOperationSchema(document, "/items", "GET"), /Schema unavailable/);
  }
});

test("unavailable repositories and malformed encoded history keys cannot invent resource counters", () => {
  const report = { execution: {}, memory: {}, browser: { localStorage: {}, breakdown: [] }, indexedDB: { available: false },
    repositories: { items: [{ id: "failed", metrics: null }] } };
  assert.deepEqual(metricValues(report, { total: null, groups: [] }), {});
  const bar = { start: 0, end: 900000, metrics: { "storage.type.%ZZ": { open: 1, close: 1, high: 1, low: 1, count: 1 } } };
  assert.deepEqual(metricSeries([bar], null), []);
});
