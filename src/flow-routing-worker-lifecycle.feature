# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing @flow-routing-worker-lifecycle
Feature: Routing workers release their execution context when the canvas closes
  Scenario: Immediate routing worker disposal aborts pending calls and releases its tracker synchronously
    Given a tracked routing worker with two pending calculations
    When the routing owner disposes its worker immediately
    Then both calculations abort and the worker is terminated and untracked before any reply
    And later replies events and calls cannot reactivate the disposed routing worker

  Scenario: Ordinary worker disposal still drains accepted repository writes
    Given a tracked repository worker with a pending save
    When the repository owner disposes its worker normally
    Then the worker remains tracked until the accepted save completes
    And the save completes before its worker is terminated and untracked
