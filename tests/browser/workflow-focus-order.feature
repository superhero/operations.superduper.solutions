# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-focus-order
Feature: Native keyboard navigation follows workflow columns
  Background:
    Given an imported workflow with shuffled nested columns and two operation owners

  Scenario: Tab follows each operation from outer inputs through its owner to outer outputs
    Then native Tab and Shift Tab visit the declared columns and grouped controls without trapping focus
    And focusing and measuring the graph preserve its saved array order and history

  Scenario: Hidden branches and disabled controls are skipped until a branch is restored
    Then hidden branches and disabled controls are absent from native traversal
    When I restore the hidden input branch with the keyboard
    Then its restored columns enter native traversal without adding navigation revisions

  Scenario: Editing and selection retain focus without rewriting the document order
    Then editing a comment and selecting an owner preserve native focus and canonical document order
