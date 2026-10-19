# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Discovery and workflow run presentation
  Scenario Outline: Keyboard focus remains visible at panel and result boundaries
    When I use a viewport of <width> by 844 pixels
    Then operations controls retain their complete keyboard focus outline
    And request fields remain readable and preserve accessible editing in both themes

    Examples:
      | width |
      | 320   |
      | 390   |
      | 1280  |

  Scenario: Matching menu rows add operations with pointer and keyboard
    When I search for the operation "Example object response"
    Then matching menu rows add operations with pointer and keyboard

  Scenario: Matching menu actions retain their idle colors across evaluations
    Then matching menu actions retain their theme colors across evaluations

  Scenario: Prompt navigation adapts without changing the composed workflow
    Given I add "Example object response" through the workflow catalog
    Then responsive prompt navigation preserves the workflow and its prompt

  Scenario: Returning to discovery leaves the workflow unchanged and new runs start fresh
    When I search for the operation "Example object response"
    And I open the "Example object response" result
    Then returning to discovery preserves the graph and a new run starts without stale results

  Scenario Outline: New runs clear earlier responses with either motion preference
    Given I open the "Example object response" operation from the catalog
    When I enter these operation inputs:
      | label      | value        |
      | Path value | project-1    |
    And I prepare the request
    Then actual responses reset with "<motion>" motion when the request changes

    Examples:
      | motion        |
      | no-preference |
      | reduce        |
