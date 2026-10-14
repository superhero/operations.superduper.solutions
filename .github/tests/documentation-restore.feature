# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @documentationRestore
Feature: Explicitly recover an exact documentation source after automatic branch deletion
  Each further destination needs its own explicitly selected pull request.
  Recovery creates only the original documentation source ref and never a PR.

  Scenario Outline: Recover the original head after a squash merge into each supported target
    Given documentation source recovery targets original base "<base>" with "a deleted source after squash merge"
    When the documentation source is explicitly restored
    Then documentation source recovery is "accepted" with "Restored documentation source" and 1 create attempts

    Examples:
      | base          |
      | main          |
      | develop       |
      | release/1.2.3 |

  Scenario: Recovery supports nested documentation branch names
    Given documentation source recovery targets original base "main" with "a nested source branch"
    When the documentation source is explicitly restored
    Then documentation source recovery is "accepted" with "Restored documentation source" and 1 create attempts

  Scenario: An already existing exact source needs no write
    Given documentation source recovery targets original base "main" with "an unchanged existing source"
    When the documentation source is explicitly restored
    Then documentation source recovery is "accepted" with "no write needed" and 0 create attempts

  Scenario: A successful recovery can be retried without another create
    Given documentation source recovery targets original base "develop" with "a deleted source after squash merge"
    When the documentation source is explicitly restored
    And the same documentation source recovery is retried
    Then documentation source recovery is "accepted" with "no write needed" and 1 create attempts

  Scenario: An advanced source branch cannot be rewound
    Given documentation source recovery targets original base "main" with "an advanced existing source"
    When the documentation source is explicitly restored
    Then documentation source recovery is "rejected" with "refusing to overwrite or rewind" and 0 create attempts

  Scenario Outline: Require a valid, explicitly pinned recovery request before querying GitHub
    Given documentation source recovery has invalid argument "<argument>" as "<value>"
    When the documentation source is explicitly restored
    Then documentation source recovery is "rejected" with "<reason>" and 0 create attempts

    Examples:
      | argument      | value               | reason                      |
      | repository    | owner/repo/other    | Usage:                      |
      | PR number     | 0                   | Usage:                      |
      | PR number     | 071                 | Usage:                      |
      | PR number     | latest              | Usage:                      |
      | source branch | feature/guide       | Usage:                      |
      | source branch | docs/               | Usage:                      |
      | source branch | docs/../main        | Invalid documentation       |
      | source branch | docs/topic.lock     | Invalid documentation       |
      | head SHA      | aaaaaaa             | Usage:                      |
      | original base | feature/other       | Original base must          |
      | original base | release/01.2.3      | valid version               |
      | original base | release/1.2         | valid version               |
      | original base | release/1.2.3-rc.1  | valid version               |

  Scenario Outline: Refuse wrong, forked, unmerged, or incomplete pull request metadata
    Given documentation source recovery reads "<state>" for the merged PR
    When the documentation source is explicitly restored
    Then documentation source recovery is "rejected" with "<reason>" and 0 create attempts

    Examples:
      | state                       | reason                     |
      | wrong PR number             | Invalid merged PR identity |
      | string PR number            | Invalid merged PR identity |
      | wrong source branch         | Invalid merged PR identity |
      | changed head SHA            | Invalid merged PR identity |
      | fork source                 | Invalid merged PR identity |
      | foreign base repository     | Invalid merged PR identity |
      | wrong original base         | Invalid merged PR identity |
      | open PR                     | Invalid merged PR identity |
      | unmerged closed PR          | Invalid merged PR identity |
      | missing merged flag         | Invalid merged PR identity |
      | draft PR                    | Invalid merged PR identity |
      | invalid merge SHA           | Invalid merged PR identity |
      | missing merge SHA           | Invalid merged PR identity |
      | missing merged timestamp    | Invalid merged PR identity |
      | malformed merged timestamp  | Invalid merged PR identity |
      | impossible merged timestamp | Invalid merged PR identity |
      | missing base SHA            | Invalid merged PR identity |
      | missing source repository   | Invalid merged PR identity |
      | malformed JSON              | Invalid merged PR identity |
      | multiple PR objects         | Invalid merged PR identity |
      | PR array                    | Invalid merged PR identity |
      | empty PR response           | Invalid merged PR identity |
      | API failure                 | Could not read the exact   |

  Scenario Outline: Only an explicit HTTP 404 with a complete missing-ref response permits creation
    Given documentation source recovery reads "<state>" for the source ref
    When the documentation source is explicitly restored
    Then documentation source recovery is "rejected" with "<reason>" and 0 create attempts

    Examples:
      | state                            | reason                       |
      | HTTP 401                         | Could not inspect source ref |
      | HTTP 403                         | Could not inspect source ref |
      | HTTP 429                         | Could not inspect source ref |
      | HTTP 503                         | Could not inspect source ref |
      | 404 only in stderr               | Could not inspect source ref |
      | 404 only in JSON                 | Could not inspect source ref |
      | 503 with a 404 body               | Could not inspect source ref |
      | 404 with invalid JSON            | Could not inspect source ref |
      | 404 with unexpected body         | Could not inspect source ref |
      | 404 with conflicting body status | Could not inspect source ref |
      | 404 with successful exit         | Could not inspect source ref |
      | incomplete 404 headers           | Could not inspect source ref |
      | 200 with failed exit             | Could not inspect source ref |
      | wrong reference                  | Invalid source ref response  |
      | tag object                       | Invalid source ref response  |
      | invalid SHA                      | Invalid source ref response  |
      | reference array                  | Invalid source ref response  |
      | multiple references              | Invalid source ref response  |

  Scenario Outline: Recheck the exact merged PR before any create
    Given documentation source recovery encounters "<state>" at the PR recheck
    When the documentation source is explicitly restored
    Then documentation source recovery is "rejected" with "<reason>" and 0 create attempts

    Examples:
      | state                   | reason                     |
      | wrong PR number         | Invalid merged PR identity |
      | changed head SHA        | Invalid merged PR identity |
      | fork source             | Invalid merged PR identity |
      | wrong original base     | Invalid merged PR identity |
      | unmerged closed PR      | Invalid merged PR identity |
      | changed merge metadata  | Merged PR metadata changed |
      | API failure             | Could not read the exact   |

  Scenario Outline: Confirm races and failed writes only when the exact original ref exists
    Given documentation source recovery targets original base "main" with "<state>"
    When the documentation source is explicitly restored
    Then documentation source recovery is "<outcome>" with "<reason>" and 1 create attempts

    Examples:
      | state                                       | outcome  | reason                              |
      | a concurrent exact restore                  | accepted | concurrent or interrupted create    |
      | a concurrent different restore              | rejected | refusing to overwrite or rewind     |
      | a rejected create with no source            | rejected | Source ref is still missing         |
      | a lost create response with exact source    | accepted | concurrent or interrupted create    |
      | a lost create response with no source       | rejected | Source ref is still missing         |
      | a failed create and failed readback         | rejected | Could not inspect source ref        |
      | an invalid create response                  | rejected | Create response did not confirm     |
      | a wrong create reference                    | rejected | Create response did not confirm     |
      | a wrong create SHA                          | rejected | different source SHA                |
      | an advanced source at readback              | rejected | refusing to overwrite or rewind     |
      | a deleted source at readback                | rejected | Source ref is still missing         |
      | an invalid readback                         | rejected | Invalid source ref response         |
      | an API failure at readback                  | rejected | Could not inspect source ref        |
