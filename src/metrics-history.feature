# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Metrics candle aggregation
  Samples become minute candles and then completed 15-minute history without retaining samples.

  Scenario: Metric values retain their exact chronological candle and sample count
    Then metrics samples preserve ordered OHLC and counts across minute boundaries

  Scenario: Gaps and clock jumps do not fabricate observations
    Then metrics history skips empty intervals and flushes only actual buckets

  Scenario: Late and invalid samples cannot reopen completed minutes
    Then metrics aggregation rejects late timestamps and ignores unavailable values

  Scenario: Live previews cannot mutate or duplicate accumulated observations
    Then metrics candle previews are independent and include the current minute once

  Scenario: A collector handoff preserves the live interval without duplicating samples
    Then metrics leader handoff preserves earlier candles and accepts only newer observations
