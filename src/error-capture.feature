# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@error-capture
Feature: Observe application failures without changing their diagnostics
  Scenario: Shared logging records failures while retaining console output
    Then error history observes error logs and warnings carrying errors without recording ordinary logs

  Scenario: Runtime failures retain their browser behavior
    Then error history observes uncaught errors and rejections without suppressing events or recording resource loads

  Scenario: Idle workers remain observable until released
    Then error history observes managed worker failures and stops observing released workers

  Scenario: Worker operations retain their origin and cause
    Then error history records worker operation and construction failures without retaining request arguments

  Scenario: The error recorder cannot record itself
    Then worker recording can be disabled for failures and cancellation never creates an error record
