# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@error-history-storage
Feature: Bounded persistent error history
  Application errors remain inspectable without unbounded storage or repeated entries.

  Background:
    Given an empty error-history database

  Scenario: Diagnostic details survive a reload and repeated occurrences aggregate
    When the same diagnostic is recorded at different times
    And the error-history page is reloaded
    Then one persisted error retains its details, occurrence count and first and last times

  Scenario: FIFO eviction preserves insertion order when an old error repeats
    When 1000 different errors have been recorded
    And the oldest error repeats before another distinct error arrives
    Then only the 1000 newest unique errors remain in insertion order

  Scenario: An error recurring after its eviction is inserted again within the same batch
    When 1000 different errors have been recorded
    And a new error is followed by the just-evicted error in one batch
    Then the recurring error is newest and the next oldest error is evicted

  Scenario: Concurrent tabs atomically combine occurrences and enforce the limit
    When two tabs record overlapping error batches concurrently
    Then their shared errors retain every occurrence without exceeding the history limit

  Scenario: Aborted writes roll back the complete batch
    When an error-history transaction aborts after its first insertion
    Then none of the aborted errors are persisted

  Scenario: Aborted eviction restores both older errors and new insertions
    When 1000 different errors have been recorded
    And an error-history transaction aborts during FIFO eviction
    Then the complete original error history remains unchanged

  Scenario: Denied storage fails safely and can recover
    When browser access to error history is denied
    Then error history can be used again after access returns

  Scenario: A blocked open times out without leaving a late database behind
    When another connection prevents error history from opening
    Then the blocked request is bounded and history recovers after the connection closes

  Scenario: A blocked transaction times out and releases its pending read
    When another connection holds an error-history write transaction
    Then the blocked transaction times out and later reads recover

  Scenario: History queries and writes reject unbounded input
    Then error history rejects oversized batches and invalid pagination
