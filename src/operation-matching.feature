# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@operation-matching
Feature: Cancellable operation matching
  Live catalog searches replace obsolete calculations without changing match ordering.

  Scenario: Background evaluation preserves ranking and original operation references
    Then background matching sends only identifiers and names and restores the complete matching operations

  Scenario: Cancellation before startup avoids creating a worker
    Then an already aborted operation search never starts its worker

  Scenario: A newer search stops obsolete work and ignores its late reply
    Then replacing an operation search terminates its worker and only the replacement can complete

  Scenario: Cancellation wins over a response awaiting publication
    Then an operation search aborted after its worker reply cannot publish that reply

  Scenario: Failed worker startup releases the calculation
    Then operation matching rejects a worker startup failure and removes its cancellation listener

  Scenario: Failed calculations release their workers
    Then operation matching preserves remote failures and releases crashed workers

  Scenario: The matching worker retains existing ranking rules
    Then the operation matching worker evaluates compact descriptors with the normal ranking rules

  Scenario: Completed workers accept schema deltas and recover from idle crashes
    Then matching reuses unchanged schema indexes and reinstalls them after an idle crash

  Scenario: Replacement cannot publish an already received configuration response
    Then a replacement search wins even without an explicit caller abort

  Scenario: Cancellation during installation retains indexes but never starts obsolete scoring
    Then an aborted installation stays reusable without starting obsolete scoring

  Scenario: Source changes serialize index installation and retain retry after failure
    Then schema changes queue coherent installations and recover after configuration failure

  Scenario: Late failure cannot close a replacement or publish a crashed reply
    Then late matching failures retain the replacement and reject replies from crashed workers
