# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Operations navigation quality
  Scenario: Step destinations remain visible below the sticky header
    When I use a viewport of 320 by 568 pixels
    And I choose the "Create task" operation from the catalog
    And I enter these operation inputs:
      | label           | value                     |
      | Project ID      | qa-project                |
      | Title           | Keep the next step visible |
      | Priority        | normal                    |
      | Estimated hours | 5                         |
    And I prepare the request
    Then the focused control is visible below the sticky header
    When I return to the form without editing
    Then the focused control is visible below the sticky header
    When I return to the prompt through progress
    Then the focused control is visible below the sticky header

  Scenario: Expanding form details does not clip the remaining controls
    When I use a viewport of 390 by 844 pixels
    And I choose the "Create task" operation from the catalog
    Then animated form details keep the active panel contained

  Scenario Outline: Retained details do not hide the focused field on short screens
    When I use a viewport of <width> by <height> pixels
    And I choose the "Create task" operation from the catalog
    And I expand the operation details
    And I return to the prompt through progress
    And I return to the form through progress
    Then the focused control is visible below the sticky header

    Examples:
      | width | height |
      | 568   | 320    |
      | 900   | 390    |
      | 320   | 480    |

  Scenario: Live reduced motion finishes an in-progress details disclosure
    Given I open the "Create task" operation from the catalog
    Then changing motion preference settles visible details immediately

  Scenario: Required dropdowns preserve validation and keyboard editing
    Given I open the "Create task" operation from the catalog
    When I enter these operation inputs:
      | label      | value           |
      | Project ID | dropdown-review |
      | Title      | Keyboard choice |
    And I try to prepare the request
    Then "Priority" is an invalid required input
    And the required Priority dropdown supports keyboard choice and cancellation
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/dropdown-review/tasks","query":{},"body":{"title":"Keyboard choice","priority":"high"}}
      """

  Scenario Outline: Dropdowns follow the theme and motion preference within the viewport
    Given I use a viewport of <width> by 568 pixels
    And I open the "Create task" operation from the catalog
    Then the Priority dropdown uses themed animated choices without overflowing

    Examples:
      | width |
      | 1280  |
      | 320   |

  Scenario: Integer arrows respect bounds and preserve native keyboard editing
    Given I open the "List projects" operation from the catalog
    Then Result limit arrows preserve bounds and input focus
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"GET","path":"/projects","query":{"limit":99}}
      """

  Scenario: Decimal arrows update the draft and the prepared request
    Given I open the "Create task" operation from the catalog
    When I enter these operation inputs:
      | label           | value          |
      | Project ID      | numeric-review |
      | Title           | Adjust hours   |
      | Priority        | normal         |
      | Estimated hours | 0.5            |
    And I increase Estimated hours with its arrow
    Then the input "Estimated hours" still contains "1.5"
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/numeric-review/tasks","query":{},"body":{"title":"Adjust hours","priority":"normal","estimate":1.5}}
      """
    When I return to the form without editing
    And I decrease Estimated hours with its arrow
    Then the input "Estimated hours" still contains "0.5"
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/numeric-review/tasks","query":{},"body":{"title":"Adjust hours","priority":"normal","estimate":0.5}}
      """

  Scenario: Number arrows slide on hover and honor reduced motion
    Given I open the "List projects" operation from the catalog
    Then number arrows reveal through hover and focus with the selected motion preference
