# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Test coverage badges reflect the measured coverage in their revision

  Scenario Outline: Coverage JSON and SVG preserve the measured percentage
    Given a coverage summary measuring <percentage> percent
    When local coverage badges are generated
    Then the coverage JSON and SVG show "<percentage>%" in "<color>"

    Examples:
      | percentage | color       |
      | 100        | brightgreen |
      | 87.5       | orange      |

  Scenario: Coverage checks detect stale badges without rewriting them
    Given generated local coverage badges
    When local coverage badges are checked
    Then the local coverage badge check succeeds
    When the measured coverage changes to 75 percent
    And local coverage badges are checked
    Then the coverage check reports stale badges without changing files
    When local coverage badges are generated
    And local coverage badges are checked
    Then the local coverage badge check succeeds
    When only the coverage SVG is changed
    And local coverage badges are checked
    Then the coverage check reports stale badges without changing files

  Scenario: Checking missing coverage badges leaves their output directory absent
    Given a coverage summary measuring 100 percent
    When local coverage badges are checked
    Then the coverage check reports missing badges without creating files

  Scenario: Invalid coverage data cannot produce a misleading badge
    Then coverage badge generation rejects these summary problems without writing files:
      | problem            |
      | malformed JSON     |
      | missing percentage |
      | string percentage  |
      | negative value     |
      | value above 100    |
