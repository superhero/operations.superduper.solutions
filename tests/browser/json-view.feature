# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@json-view
Feature: Read-only operation JSON
  Scenario Outline: Local schema references unfold and scroll without changing the operation
    Given the Example POST body JSON report is open at <width> pixels
    When I follow a local JSON reference into a folded schema
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

    Examples:
      | width |
      | 1280  |
      | 320   |

  Scenario: Reference navigation reaches paginated targets and handles JSON pointer boundaries
    Then local JSON references reach paginated targets and preserve literal unresolved references

  Scenario: Native keyboard folding preserves operation inputs
    Given the Example POST body JSON report is open at 1280 pixels
    When I fold the JSON root and nested operation branches with the keyboard
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

  Scenario: Nested JSON branches slide and reverse without losing folding choices
    Given the Example POST body JSON report is open at 1280 pixels
    When I reverse a sliding JSON branch and enable reduced motion
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

  Scenario: Copy includes folded JSON and reports clipboard failures honestly
    Given the Example POST body JSON report is open at 1280 pixels
    When I copy the complete JSON across folding wrapping and clipboard failures
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

  Scenario Outline: Copy feedback preserves JSON focus and layout
    Given the Example POST body JSON report is open at <width> pixels
    When delayed clipboard success and failure leave the JSON controls in place
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

    Examples:
      | width |
      | 1280  |
      | 320   |

  Scenario: JSON wrapping and horizontal scrolling stay inside a narrow report
    Given the Example POST body JSON report is open at 320 pixels
    When I read wrapped and unwrapped JSON on the narrow screen
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

  Scenario: Metrics refresh during JSON review preserves application data
    Given the Example POST body JSON report is open at 1280 pixels
    When the cached metrics report refreshes while I review JSON
    And I fold the JSON root and nested operation branches with the keyboard
    Then reviewing JSON has left the operation draft and non-metric local storage unchanged

  Scenario: Settings schema methods are expanded for an operation overview
    Then the Settings schema viewer expands HTTP methods but keeps their details folded

  Scenario: Schema edit icons fade through opening closing and interruption
    Then schema edit icons fade in and out and respect reduced motion

  Scenario: Schema header hover stays visible across card transitions
    Then the scaled schema header keeps its edges visible while card slides stay clipped

  Scenario Outline: Schema cards keep compact controls and a full-width viewer
    Then schema cards keep their controls usable and their viewer full width at <width> pixels

    Examples:
      | width |
      | 1280  |
      | 320   |
