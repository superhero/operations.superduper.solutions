# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@automation
Feature: Every source behavior reaches the shared Cucumber reports

  Scenario: Source and acceptance profiles register every local feature exactly once
    Then every source feature and its steps belong to exactly one explicit reporting profile
    And the source test command runs Cucumber without a separate Node test runner

  Scenario Outline: Individual results survive execution and report generation
    Given two named source scenarios with a second scenario that has "<outcome>"
    When the repository source test command runs against those scenarios
    Then its exit status and Cucumber JSON reflect "<outcome>" for the second scenario
    And the generated HTML and scenario badge retain both individual results

    Examples:
      | outcome            |
      | passing behavior   |
      | assertion failure  |
      | After-hook failure |
