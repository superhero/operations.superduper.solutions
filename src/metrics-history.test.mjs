// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { MetricsAggregator, metricsMinuteDuration as minute, metricsBarDuration as quarter } from "./lib/metrics-history.ts";

const start = Date.UTC(2026, 0, 1, 12, 0);
const candle = (open, high, low, close, count) => ({ open, high, low, close, count });

Then("metrics samples preserve ordered OHLC and counts across minute boundaries", function () {
  const aggregator = new MetricsAggregator();
  for (const [offset, values] of [[100, { usage: 12, memory: 64 }], [200, { usage: 8 }],
    [minute, { usage: 13, memory: 32 }], [2 * minute, { usage: 0 }], [quarter - 1, { usage: 11, memory: 128 }]])
    assert.deepEqual(aggregator.add({ timestamp: start + offset, values }), []);
  assert.deepEqual(aggregator.add({ timestamp: start + quarter, values: { usage: 20 } }), [{
    start, end: start + quarter, metrics: { usage: candle(12, 13, 0, 11, 5), memory: candle(64, 128, 32, 128, 3) },
  }]);
  assert.deepEqual(aggregator.activeBar(), {
    start: start + quarter, end: start + 2 * quarter, metrics: { usage: candle(20, 20, 20, 20, 1) },
  });
});

Then("metrics history skips empty intervals and flushes only actual buckets", function () {
  const aggregator = new MetricsAggregator();
  aggregator.add({ timestamp: start + 1, values: { usage: -2 } });
  assert.deepEqual(aggregator.add({ timestamp: start + 3 * quarter + 1, values: { usage: 7 } }), [{
    start, end: start + quarter, metrics: { usage: candle(-2, -2, -2, -2, 1) },
  }]);
  assert.deepEqual(aggregator.flush(start + 100 * quarter), [{
    start: start + 3 * quarter, end: start + 4 * quarter, metrics: { usage: candle(7, 7, 7, 7, 1) },
  }]);
  assert.equal(aggregator.activeBar(), null);
  assert.deepEqual(aggregator.flush(start + 200 * quarter), []);
  // A forward clock jump closes existing data, but does not mark empty future intervals closed.
  aggregator.add({ timestamp: start + 4 * quarter, values: { usage: 9 } });
  assert.deepEqual(aggregator.flush(start + 5 * quarter).map(bar => bar.start), [start + 4 * quarter]);
  assert.deepEqual(aggregator.flush(start + 5 * quarter), []);
});

Then("metrics aggregation rejects late timestamps and ignores unavailable values", function () {
  const aggregator = new MetricsAggregator();
  aggregator.add({ timestamp: start + 20, values: { usage: 1, unavailable: NaN, infinite: Infinity } });
  aggregator.add({ timestamp: start + 10, values: { usage: 999 } });
  aggregator.add({ timestamp: start + 20, values: { usage: 2 } });
  for (const timestamp of [NaN, Infinity, -Infinity, start + 0.5])
    assert.deepEqual(aggregator.add({ timestamp, values: { usage: 999 } }), []);
  assert.deepEqual(aggregator.flush(Infinity), []);
  assert.deepEqual(aggregator.flush(start + minute), []);
  aggregator.add({ timestamp: start + 50, values: { usage: 999 } });
  aggregator.add({ timestamp: start + minute, values: { usage: 3 } });
  assert.deepEqual(aggregator.add({ timestamp: start + quarter, values: {} }), [{
    start, end: start + quarter, metrics: { usage: candle(1, 3, 1, 3, 3) },
  }]);
  aggregator.add({ timestamp: start + quarter - 1, values: { usage: 999 } });
  assert.equal(aggregator.activeBar(), null);
  assert.deepEqual(aggregator.add({ timestamp: start + 2 * quarter, values: { usage: NaN } }), []);
  assert.equal(aggregator.activeBar(), null);
});

Then("metrics candle previews are independent and include the current minute once", function () {
  const aggregator = new MetricsAggregator();
  assert.equal(aggregator.activeBar(), null);
  aggregator.add({ timestamp: start, values: JSON.parse('{"usage":4,"__proto__":7,"constructor":9}') });
  const preview = aggregator.activeBar();
  preview.metrics.usage.close = 999;
  preview.metrics.__proto__.count = 999;
  preview.start = 0;
  assert.equal(aggregator.activeBar().metrics.usage.close, 4);
  assert.equal(aggregator.activeBar().metrics.__proto__.count, 1);
  assert.equal(aggregator.activeBar().metrics.constructor.open, 9);
  aggregator.add({ timestamp: start + minute, values: { usage: 8 } });
  const active = aggregator.activeBar();
  assert.deepEqual(active.metrics.usage, candle(4, 8, 4, 8, 2));
  assert.deepEqual(aggregator.activeBar(), active);
  aggregator.flush(start + 2 * minute);
  assert.deepEqual(aggregator.activeBar(), active);
  const [completed] = aggregator.flush(start + quarter);
  assert.deepEqual(completed, active);
  completed.metrics.usage.count = 999;
  aggregator.add({ timestamp: start + quarter, values: { usage: 12 } });
  assert.equal(aggregator.activeBar().metrics.usage.count, 1);
});

Then("metrics leader handoff preserves earlier candles and accepts only newer observations", function () {
  const first = new MetricsAggregator();
  first.add({ timestamp: start, values: { usage: 12 } });
  first.add({ timestamp: start + minute + 1, values: { usage: 8 } });
  const preview = first.activeBar();
  const next = new MetricsAggregator(preview, start + minute + 1);
  preview.metrics.usage.high = 999;
  next.add({ timestamp: start + minute, values: { usage: 999 } });
  next.add({ timestamp: start + minute + 2, values: { usage: 10 } });
  next.add({ timestamp: start + 2 * minute, values: { usage: 14 } });
  assert.deepEqual(next.activeBar().metrics.usage, candle(12, 14, 8, 14, 4));
  const [completed] = next.flush(start + quarter);
  assert.deepEqual(completed.metrics.usage, candle(12, 14, 8, 14, 4));
  assert.equal(next.activeBar(), null);
  const elapsed = new MetricsAggregator(first.activeBar(), start + minute + 1);
  assert.deepEqual(elapsed.flush(start + quarter)[0].metrics.usage, candle(12, 12, 8, 8, 2));
  const noTimestamp = new MetricsAggregator(first.activeBar(), Infinity);
  noTimestamp.add({ timestamp: start - 1, values: { usage: 999 } });
  assert.deepEqual(noTimestamp.activeBar(), first.activeBar());
});
