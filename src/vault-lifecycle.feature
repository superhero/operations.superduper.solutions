# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-lifecycle
Feature: Explicit vault inactivity deadlines
  A delayed interaction cannot revive an expired unlocked session.
  The client locks on page exit; changing tab visibility does not end access.

  Scenario: Idle locking starts disabled
    Then vault inactivity starts disabled and only explicit activation starts a session

  Scenario: Only trusted foreground activity extends access
    Then vault inactivity ignores synthetic and background activity

  Scenario: Delayed activity cannot revive an expired session
    Then an expired vault locks before activity or preference changes can extend it

  Scenario: Preference changes retain the last real activity
    Then changing vault inactivity preferences uses the previous activity time

  Scenario: Invalid durations cannot weaken the policy
    Then vault inactivity accepts only whole minutes from one through fourteen forty

  Scenario: Clock discontinuity and stale checks fail closed
    Then vault inactivity locks on a backward or invalid clock and remains inactive until unlock

  Scenario: Deactivation clears the worker deadline
    Then vault inactivity deactivation is idempotent and explicit unlock starts a new deadline
