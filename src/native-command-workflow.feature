# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-command-workflow
Feature: Owned commands in workflows
  Dispatch, byte output and terminal results have distinct ports and lifetimes.

  Scenario: Command models preserve native inputs and distinct dispatch output and result ports
    Then native command models round trip their typed lifecycle ports and field diagnostics

  Scenario: Dispatched process handles drive resize stdin and termination before exit
    Then command workflow controls use the dispatched owned process while terminal results wait

  Scenario: Buffered command consumers wait for real terminal output
    Then command terminal workflow mappings wait for completion and wake their downstream form

  Scenario: Command cancellation releases waiting terminal consumers
    Then command workflow stop releases pending terminal mappings without fabricating a result

  Scenario: Unowned or reordered command samples cannot promote a workflow
    Then command workflows reject foreign out of order duplicate and incomplete lifecycle samples
