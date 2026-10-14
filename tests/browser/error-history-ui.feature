# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Recorded errors in Browser settings
  Error history stays available independently of resource sampling and survives reloads.

  Scenario: Error details preserve cause chains and paginate saved history
    Given 26 saved errors including a repeated failure with a cause
    When I open the recorded errors in Browser settings
    Then the error history shows 26 unique errors and 25 entries
    When I expand the newest recorded error
    Then its saved cause, stack, occurrence count and observation times are visible
    When I open the older recorded errors
    Then the error history shows the oldest saved error
    When I reload and open the recorded errors
    Then the error history shows 26 unique errors and 25 entries

  Scenario: Error history refreshes when another tab saves an error
    When I open the recorded errors in Browser settings
    Then the error history is empty
    When another tab records a failure
    Then the error history shows 1 unique errors and 1 entries

  Scenario: A failed recorder bounds queued errors and resumes after explicit retry
    Given an isolated running error recorder
    When the recorder cannot write its next error
    Then the recorder pauses with 1 unconfirmed occurrence
    When 70 distinct errors occur while recording is paused
    Then 64 unique errors wait for retry and 6 occurrences were dropped
    When I retry the isolated error recorder
    Then 64 unique errors are saved without recording the storage failure

  Scenario: A silent worker cannot cause replay of a possibly committed error
    Given an isolated running error recorder
    When the error worker saves an error without acknowledging it
    Then the recorder pauses with 1 unconfirmed occurrence
    When I retry the isolated error recorder
    Then the acknowledged history contains the error exactly once

  Scenario: Repeated pending errors coalesce without losing occurrence counts
    Given an isolated running error recorder
    When the same error is reported 80 times before recording runs
    Then one saved error contains 80 occurrences

  Scenario: An idle recorder worker failure cannot record itself
    Given an isolated running error recorder
    When the idle error worker crashes
    Then the recorder reports its own failure without recording an application error
    When I retry the isolated error recorder
    Then the retried recorder has no saved errors

  Scenario: Uncaught application errors and rejected promises retain browser reporting and history
    When the built application throws an error and rejects an unhandled promise
    And I open the recorded errors in Browser settings
    Then both runtime failures appear in history and preserve their original browser errors
    When I reload and open the recorded errors
    Then both runtime failures remain in the saved error history
