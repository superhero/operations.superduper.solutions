# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Operations presentation
  Scenario Outline: Keyboard focus remains visible at panel and result boundaries
    When I use a viewport of <width> by 844 pixels
    Then operations controls retain their complete keyboard focus outline
    And request fields remain readable and preserve accessible editing in both themes

    Examples:
      | width |
      | 320   |
      | 390   |
      | 1280  |

  Scenario: Evaluation rows open their operation without swallowing help controls
    When I search for the operation "Get project"
    Then result row padding opens the operation while help and keyboard actions remain independent

  Scenario: Progress distinguishes available actions while preserving selected menu colors
    Then progress colors and navigation states match their roles in both themes

  Scenario: Progress adapts to available space without losing the operation draft
    Given I open the "Get project" operation from the catalog
    Then progress switches between labels and numbers without losing the operation draft

  Scenario: Progress stays above adjacent steps until its hover animation settles
    When I search for the operation "Get project"
    And I open the "Get project" result
    Then progress hover layering follows its animation through exit and re-entry

  Scenario Outline: Actual responses reset on editing with either motion preference
    Given I open the "Get project" operation from the catalog
    When I enter these operation inputs:
      | label      | value        |
      | Project ID | project-1    |
    And I prepare the request
    Then actual responses reset with "<motion>" motion when the request changes

    Examples:
      | motion        |
      | no-preference |
      | reduce        |
