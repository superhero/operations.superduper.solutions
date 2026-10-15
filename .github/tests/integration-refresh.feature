# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @integration-refresh
Feature: Refresh a queued candidate without overwriting a newer source
  The isolated write job retains the original head lease and verifies uncertain
  outcomes before retrying. A refreshed source receives a separate CI run.

  Scenario Outline: Branch refresh handles <condition>
    Given the queued branch refresh encounters "<condition>"
    When the queued branch refresh script runs
    Then branch refresh reports "<outcome>" after <reads> reads and <writes> writes
    And branch refresh uses the expected-head lease without exposing credentials

    Examples:
      | condition                                                | outcome        | reads | writes |
      | an unchanged candidate                                   | accepted       | 1     | 1      |
      | a closed candidate                                       | skipped        | 1     | 0      |
      | a merged candidate                                       | skipped        | 1     | 0      |
      | a draft candidate                                        | skipped        | 1     | 0      |
      | a newer source head                                      | skipped        | 1     | 0      |
      | a changed source branch                                  | route rejected | 1     | 0      |
      | a changed target branch                                  | route rejected | 1     | 0      |
      | a changed source repository                              | route rejected | 1     | 0      |
      | a different pull request                                 | route rejected | 1     | 0      |
      | a rejected lease after the head advanced                  | skipped        | 2     | 1      |
      | a timed out write that already advanced the head          | skipped        | 2     | 1      |
      | a transient write error after the candidate closed        | skipped        | 2     | 1      |
      | a route change during write readback                      | route rejected | 2     | 1      |
      | a rejected update with the same live head                 | update failed  | 2     | 1      |
      | a transient write followed by success                    | accepted       | 3     | 2      |
      | three transient writes with the same live head            | update failed  | 6     | 3      |
      | the final timed out write already advanced the head       | skipped        | 6     | 3      |
      | a forbidden initial read                                 | read failed    | 1     | 0      |
      | three transient initial reads                            | read failed    | 3     | 0      |
      | two transient reads followed by success                   | accepted       | 3     | 1      |
      | an unverifiable write readback                           | read failed    | 2     | 1      |
      | malformed initial JSON                                   | read failed    | 1     | 0      |

  Scenario Outline: Invalid refresh input <field> cannot make an API request
    Given the queued branch refresh has invalid "<field>"
    When the queued branch refresh script runs
    Then branch refresh reports "input rejected" after 0 reads and 0 writes
    And branch refresh uses the expected-head lease without exposing credentials

    Examples:
      | field       |
      | REPOSITORY  |
      | PR_NUMBER   |
      | HEAD_SHA    |
      | HEAD_BRANCH |
      | BASE_BRANCH |
