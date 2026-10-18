# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@browser-abort-diagnostics
Feature: Browser cancellation preserves bounded failure diagnostics

  Scenario: An aborted browser operation retains its timeout and completed diagnostic artifacts
    Given an isolated browser page records an abort diagnostic trace
    When its pending operation is aborted with its original timeout
    Then the operation settles and its owned context closes without changing the timeout
    And its completed trace and screenshot remain available after cleanup

  Scenario: An unresponsive trace capture cannot postpone context disposal
    Given an isolated browser page has an unresponsive trace capture
    When its pending operation is aborted with its original timeout
    Then the operation settles and its owned context closes without changing the timeout
    And the capture deadline records the missing trace without advertising late artifacts
