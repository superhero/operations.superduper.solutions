# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Operations navigation quality
  Scenario: Required dropdowns preserve validation and keyboard editing
    Given I open the "Example POST body" operation from the catalog
    When I enter these operation inputs:
      | label      | value           |
      | Path value | dropdown-review |
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
    And I open the "Example POST body" operation from the catalog
    Then the Priority dropdown uses themed animated choices without overflowing

    Examples:
      | width |
      | 1280  |
      | 320   |

  Scenario: Integer sliders respect bounds and preserve exact keyboard editing
    Given I open the "Example array response" operation from the catalog
    Then the Result limit slider preserves bounds and keyboard focus
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"GET","path":"/projects","query":{"limit":99}}
      """

  Scenario: Decimal arrows update the draft and the prepared request
    Given I open the "Example POST body" operation from the catalog
    When I enter these operation inputs:
      | label           | value          |
      | Path value      | numeric-review |
      | Title           | Adjust hours   |
      | Priority        | normal         |
      | Number value | 0.5            |
    And I increase Number value with its arrow
    Then the input "Number value" still contains "1.5"
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/numeric-review/tasks","query":{},"body":{"title":"Adjust hours","priority":"normal","estimate":1.5}}
      """
    When I restart the run with the same inputs
    And I decrease Number value with its arrow
    Then the input "Number value" still contains "0.5"
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/numeric-review/tasks","query":{},"body":{"title":"Adjust hours","priority":"normal","estimate":0.5}}
      """

  Scenario: Optional integer sliders preserve exact large values and can be cleared
    Given I open the "Example query and header inputs" operation from the catalog
    Then the optional Count slider preserves large signed integers and clears without a default

  Scenario: Number arrows slide on hover and honor reduced motion
    Given I open the "Example POST body" operation from the catalog
    Then number arrows reveal through hover and focus with the selected motion preference
