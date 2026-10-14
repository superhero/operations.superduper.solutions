# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@metrics-cache
Feature: Metrics cache
  Cached measurements provide bounded, valid snapshots while persistent data loads.

  Scenario: Metrics cache round-trips completed history before a live report exists
    Then metrics cache round-trips completed history before a live report exists

  Scenario: Metrics cache round-trips a full report and page-memory breakdown without mutating the input
    Then metrics cache round-trips a full report and page-memory breakdown without mutating the input

  Scenario: Metrics cache retains the newest 96 completed intervals and excludes live or raw samples
    Then metrics cache retains the newest 96 completed intervals and excludes live or raw samples

  Scenario: An older writer cannot replace a more recent report
    Then an older writer cannot replace a more recent report

  Scenario: Metrics cache ignores invalid JSON, unsupported envelopes, and malformed nested measurements
    Then metrics cache ignores invalid JSON, unsupported envelopes, and malformed nested measurements

  Scenario: Metrics cache bounds serialized input and output
    Then metrics cache bounds serialized input and output

  Scenario: Missing, denied, unreadable, and quota-limited localStorage never break metric collection
    Then missing, denied, unreadable, and quota-limited localStorage never break metric collection

  Scenario: Cached database inventories preserve partial enumeration and compound or external keys
    Then cached database inventories preserve partial enumeration and compound or external keys

  Scenario: Cache retains the newest complete candles when earlier candles exceed its byte budget
    Then cache retains the newest complete candles when earlier candles exceed its byte budget
