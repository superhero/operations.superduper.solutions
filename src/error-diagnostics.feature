# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Bounded application error diagnostics
  Error recording preserves useful diagnostics without inspecting application data
  or interrupting the original error report.

  Scenario: Native errors retain their causes and reporting origin
    Then error snapshots retain diagnostic fields without retaining application objects

  Scenario: Thrown values remain understandable
    Then error snapshots describe primitive values and incomplete error objects

  Scenario: Hostile diagnostic properties cannot interrupt reporting
    Then error snapshots tolerate throwing getters and revoked proxies

  Scenario: Nested errors and large text have bounded snapshots
    Then error snapshots bound text nesting aggregate children and total nodes

  Scenario: Duplicate identities describe the error and its origin
    Then error identities are stable and distinguish changed diagnostics

  Scenario: Inline worker identities survive new worker instances
    Then named worker identities ignore blob identifiers while preserving source locations

  Scenario: One failure keeps its origin across reporting channels
    Then repeated reporting of an error object preserves its first captured origin

  Scenario: Subscribers cannot break error reporting
    Then diagnostic subscriptions isolate failures recursion and listener changes
