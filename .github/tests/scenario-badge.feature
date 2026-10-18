# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Scenario badges reflect individual Vitest Gherkin outcomes

  Scenario: Outline examples count separately and backgrounds do not count as scenarios
    Given real passing Vitest outline results with a background
    When local scenario badges are generated
    Then the scenario JSON and SVG show "3 passed" in "brightgreen"
    When local scenario badges are checked
    Then the local scenario badge check succeeds

  Scenario: Scenario cleanup failures and unfinished cases affect the badge
    Given real passing Vitest outline results with a background
    Then these recorded scenario outcomes produce badges:
      | status   | message    | color  |
      | failed   | 2/3 passed | red    |
      | skipped  | 2/3 passed | orange |
      | pending  | 2/3 passed | orange |
      | todo     | 2/3 passed | orange |
      | disabled | 2/3 passed | orange |

  Scenario: Stale JSON and SVG checks leave committed badge files unchanged
    Given real passing Vitest outline results with a background
    When local scenario badges are generated
    And only the scenario SVG is changed
    And local scenario badges are checked
    Then the scenario check reports stale "test-scenarios.svg" without changing files
    When local scenario badges are generated
    And a scenario result changes
    And local scenario badges are checked
    Then the scenario check reports stale "test-scenarios.json" without changing files

  Scenario: Invalid or empty reports cannot produce misleading scenario badges
    Then scenario badge generation rejects these report problems without writing files:
      | problem                     |
      | missing file                |
      | malformed JSON              |
      | empty report                |
      | no scenarios                |
      | missing scenario identity   |
      | duplicate scenario identity |
      | empty steps                 |
      | missing step status         |
      | unknown result status       |
      | inconsistent totals         |
