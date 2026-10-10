# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Workflow branch selection
  Modifier clicks and double-clicks select workflow nodes without changing the workflow.
  Drag rectangles disappear on release while the selection remains.

  Scenario: Shift-drag rectangles add to existing selection and discard only transient hits
    Given nested workflow input and output branches mapped to another operation
    Then Shift-drag rectangles retain prior nodes and edges while adding only their current hits
    And branch selection preserves the saved workflow and its revision

  Scenario: Shift-click toggles operation and data nodes after box selection while retaining other selections
    Given nested workflow input and output branches mapped to another operation
    Then Shift-click toggles operation headers data headers and fields while Control-click still works
    And branch selection preserves the saved workflow and its revision

  Scenario: Double-click selects owned descendants without following mappings or hidden branches
    Given nested workflow input and output branches mapped to another operation
    Then double-clicking owners and data panels replaces selection with their visible branches
    And branch selection preserves the saved workflow and its revision

  Scenario Outline: Boxed nodes can be deselected using <gesture>
    Given nested workflow input and output branches mapped to another operation
    Then I can clear boxed workflow nodes using "<gesture>"
    And branch selection preserves the saved workflow and its revision

    Examples:
      | gesture                      |
      | Shift-click the only node    |
      | click an empty selected gap  |
      | Escape from canvas           |
      | Escape from node             |
