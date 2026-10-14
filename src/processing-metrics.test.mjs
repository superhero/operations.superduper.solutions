// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { collectProcessingMetrics, startProcessingMetrics, stopProcessingMetrics } from "./lib/processing-metrics.ts";

Then("processing measurements drain and reset bounded counters, preserve late tasks, and stop cleanly", () => {
  const originals = Object.fromEntries(["window", "performance", "PerformanceObserver"]
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let now = 100;
  let current;
  class Observer {
    static supportedEntryTypes = ["longtask"];
    records = [];
    disconnected = false;
    constructor(callback) { this.callback = callback; current = this; }
    observe(options) { assert.deepEqual(options, { type: "longtask" }); }
    takeRecords() { const result = this.records; this.records = []; return result; }
    disconnect() { this.disconnected = true; }
    emit(entries) { this.callback({ getEntries: () => entries }); }
  }
  const entry = (startTime, duration, entryType = "longtask") => ({ startTime, duration, entryType });
  const empty = interval => ({ longTasks: 0, longTaskTime: 0, blockingTime: 0, longestTask: 0, interval, error: null });
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
    Object.defineProperty(globalThis, "PerformanceObserver", { configurable: true, value: Observer });
    startProcessingMetrics();
    const first = current;
    startProcessingMetrics();
    assert.equal(current, first, "Starting twice keeps the active interval.");
    current.emit([entry(0, 200), entry(100, 49), entry(100, NaN), entry(NaN, 70), entry(100, 80, "mark"), entry(110, 50)]);
    current.records = [entry(180, 120)];
    now = 400;
    assert.deepEqual(collectProcessingMetrics(), {
      longTasks: 2, longTaskTime: 170, blockingTime: 70, longestTask: 120, interval: 300, error: null,
    });
    now = 420;
    assert.deepEqual(collectProcessingMetrics(), empty(20));
    // The task spanning the prior read appears only after the browser completes it.
    current.emit([entry(180, 120), entry(390, 80)]);
    now = 500;
    assert.deepEqual(collectProcessingMetrics(), {
      longTasks: 1, longTaskTime: 80, blockingTime: 30, longestTask: 80, interval: 80, error: null,
    });
    stopProcessingMetrics();
    stopProcessingMetrics();
    assert.equal(first.disconnected, true);
    assert.equal(collectProcessingMetrics().longTasks, null);
    now = 1000;
    startProcessingMetrics();
    first.emit([entry(1100, 500)]);
    current.emit([entry(900, 100)]);
    now = 1200;
    assert.deepEqual(collectProcessingMetrics(), empty(200), "Restart excludes paused time and stale observers.");
    stopProcessingMetrics();
    Observer.supportedEntryTypes = [];
    startProcessingMetrics();
    assert.deepEqual(collectProcessingMetrics(), {
      longTasks: null, longTaskTime: null, blockingTime: null, longestTask: null, interval: null,
      error: "This browser does not support long-task measurements.",
    });
    Observer.supportedEntryTypes = ["longtask"];
    startProcessingMetrics();
    current.takeRecords = () => { throw new Error("Collection failed"); };
    assert.equal(collectProcessingMetrics().error, "Collection failed");
    assert.equal(current.disconnected, true);
    startProcessingMetrics();
    current.takeRecords = () => { throw "Collection interrupted"; };
    assert.equal(collectProcessingMetrics().error, "Collection interrupted");
    Observer.prototype.observe = () => { throw new Error("Observation failed"); };
    startProcessingMetrics();
    assert.equal(collectProcessingMetrics().error, "Observation failed");
    assert.equal(current.disconnected, true);
    Observer.prototype.observe = () => { throw "Observation interrupted"; };
    startProcessingMetrics();
    assert.equal(collectProcessingMetrics().error, "Observation interrupted");
  } finally {
    stopProcessingMetrics();
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
