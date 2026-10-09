# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Read-only operation JSON
  Scenario: Native keyboard folding preserves operation inputs
    Given the Create task JSON report is open at 1280 pixels
    When I fold the JSON root and nested operation branches with the keyboard
    Then reviewing JSON has left the operation draft and local storage unchanged

  Scenario: Nested JSON branches slide and reverse without losing folding choices
    Given the Create task JSON report is open at 1280 pixels
    When I reverse a sliding JSON branch and enable reduced motion
    Then reviewing JSON has left the operation draft and local storage unchanged

  Scenario: Copy includes folded JSON and reports clipboard failures honestly
    Given the Create task JSON report is open at 1280 pixels
    When I copy the complete JSON across folding wrapping and clipboard failures
    Then reviewing JSON has left the operation draft and local storage unchanged

  Scenario Outline: Copy feedback preserves JSON focus and layout
    Given the Create task JSON report is open at <width> pixels
    When delayed clipboard success and failure leave the JSON controls in place
    Then reviewing JSON has left the operation draft and local storage unchanged

    Examples:
      | width |
      | 1280  |
      | 320   |

  Scenario: JSON wrapping and horizontal scrolling stay inside a narrow report
    Given the Create task JSON report is open at 320 pixels
    When I read wrapped and unwrapped JSON on the narrow screen
    Then reviewing JSON has left the operation draft and local storage unchanged
