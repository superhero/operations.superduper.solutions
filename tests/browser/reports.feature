# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Local evaluation and operation reports
  Scenario Outline: Evaluation reports explain the actual local comparison
    When I search for the operation "<prompt>"
    And I review the matching details
    Then the evaluation report records "<prompt>" with top similarity "<similarity>"
    And the evaluation columns show "<proposed>" opposite "<not_proposed>"

    Examples:
      | prompt               | similarity | proposed                   | not_proposed                                                  |
      | List projects        | 100%       | List projects, Get project | Mock query and header inputs, HTTPBin query and header inputs |
      | List projetcs        | 85%        | List projects, Get project | Mock query and header inputs, HTTPBin query and header inputs |
      | List projects please | 65%        | List projects              | Get project                                                   |
      | task                 | 36%        |                            |                                                               |

  Scenario: Editing the prompt leaves the submitted report intact until a new search
    When I search for the operation "List projects"
    And I review the matching details
    And I edit the report prompt to "zzzzzzzzzzzz" without submitting
    Then the previous evaluation report remains unchanged
    When I submit the edited report prompt
    Then the new evaluation starts with its report closed
    When I review the matching details
    Then the evaluation report records "zzzzzzzzzzzz" with top similarity "0%"

  Scenario: Operation reports separate catalog sources and input locations while retaining drafts
    Given I open the "Create task" operation from the catalog
    When I enter these operation inputs:
      | label      | value                 |
      | Project ID | report-project        |
      | Title      | Preserve report draft |
      | Priority   | normal                |
    And I expand the operation details
    Then the operation report describes the demo Create task source and inputs
    And changing the reported operation resets its schema view without losing the draft

  Scenario Outline: Expanded reports fit the available space in both themes
    Then both reports fit a <width> pixel viewport in the "<theme>" theme

    Examples:
      | width | theme |
      | 1280  | light |
      | 390   | dark  |
