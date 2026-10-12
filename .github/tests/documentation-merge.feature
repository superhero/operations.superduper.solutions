# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Documentation merges do not interrupt production publication

  Scenario: Develop documentation does not need production release inspection
    Given documentation publication inspection targets "develop" with "an active release"
    When documentation publication safety is checked
    Then documentation publication safety is "accepted" with ""

  Scenario Outline: Inspect all active production workflow pages before updating main
    Given documentation publication inspection targets "main" with "<state>"
    When documentation publication safety is checked
    Then documentation publication safety is "<outcome>" with "<reason>"

    Examples:
      | state                    | outcome  | reason                         |
      | no active runs           | accepted |                                |
      | unrelated active runs    | accepted |                                |
      | an active release        | rejected | Rerun documentation CI         |
      | an active hotfix         | rejected | Rerun documentation CI         |
      | release preparation      | rejected | Rerun documentation CI         |
      | a release on page two    | rejected | release/1.2.3                  |
      | an API failure           | rejected | Could not inspect              |
      | malformed JSON           | rejected | Invalid or incomplete          |
      | an invalid response      | rejected | Invalid or incomplete          |
      | an invalid branch        | rejected | Invalid or incomplete          |
      | an invalid run ID        | rejected | Invalid or incomplete          |
      | an unexpected run status | rejected | Invalid or incomplete          |
      | incomplete pagination    | rejected | Invalid or incomplete          |
      | duplicate run IDs        | rejected | Invalid or incomplete          |
      | inconsistent page totals | rejected | Invalid or incomplete          |

  Scenario Outline: Invalid documentation destinations never query or merge
    Given documentation publication inspection targets "<target>" with "no active runs"
    When documentation publication safety is checked
    Then documentation publication safety is "rejected" with "Usage:"

    Examples:
      | target        |
      | release/1.2.3 |
      | other         |
