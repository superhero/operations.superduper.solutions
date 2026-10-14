# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @documentation-merge
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
      | hotfix/1.2.3 |
      | other         |

  Scenario Outline: Release documentation waits for publication to finish
    Given documentation publication inspection targets "release/1.2.3" with "<state>"
    When documentation publication safety is checked
    Then documentation publication safety is "<outcome>" with "<reason>"

    Examples:
      | state                 | outcome  | reason                 |
      | no active runs        | accepted |                        |
      | unrelated active runs | accepted |                        |
      | an active release     | rejected | Rerun documentation CI |
      | an active hotfix      | rejected | Rerun documentation CI |
      | release preparation   | rejected | Rerun documentation CI |
      | a release on page two | rejected | release/1.2.3          |
      | an API failure        | rejected | Could not inspect      |
      | incomplete pagination | rejected | Invalid or incomplete  |

  Scenario: Malformed release destinations never inspect publication
    Given documentation publication inspection targets "release/next" with "no active runs"
    When documentation publication safety is checked
    Then documentation publication safety is "rejected" with "Invalid target release version"

  Scenario Outline: Bound the wait for a generated changelog PR's creating workflow
    Given generated changelog publication waits "4" seconds with "<state>"
    When bounded documentation publication safety is checked
    Then bounded documentation publication is "<outcome>" after <reads> reads with "<reason>"

    Examples:
      | state                            | outcome  | reads | reason                  |
      | a finishing release              | accepted | 2     |                         |
      | a release exceeding the deadline | rejected | 3     | Rerun documentation CI  |
      | an API failure while waiting     | rejected | 2     | Could not inspect       |
      | invalid data while waiting       | rejected | 2     | Invalid or incomplete   |

  Scenario Outline: Invalid documentation wait settings fail before API access
    Given generated changelog publication waits "<seconds>" seconds with "an invalid wait setting"
    When bounded documentation publication safety is checked
    Then bounded documentation publication is "rejected" after 0 reads with "must be an integer from 0 to 120"

    Examples:
      | seconds |
      | -1      |
      | 1.5     |
      | 121     |
      | 9999    |
      | 04      |
      | later   |
