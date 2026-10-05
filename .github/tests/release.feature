# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Release automation
  Releases reuse their identity on retries and deploy only the validated build
  belonging to the release currently on main.

  Scenario: Create the next patch release
    Given the latest release tag is "0.0.24"
    When release creation succeeds
    Then release PR 124 identifies version "0.0.25" and its source commit
    And no release comments are posted

  Scenario: Dependency badge updates on main do not block the next release
    Given develop has unreleased changes and main has only newer dependency badges
    When release creation succeeds
    Then release PR 124 identifies version "0.0.25" and its source commit

  Scenario: A release preserves main ancestry after squash synchronization
    Given develop has new work after squash synchronization with main
    When release creation succeeds
    Then release PR 124 identifies version "0.0.25" and its source commit

  Scenario Outline: Retry an interrupted or completed release
    Given the same release already has "<existing>"
    When release creation succeeds
    Then release PR 124 identifies version "0.0.25"
    And the retry performs <writes> GitHub writes

    Examples:
      | existing                              | writes |
      | an open PR                            | 0      |
      | a merged PR                           | 0      |
      | only its branch                       | 1      |
      | its prepared integration              | 1      |
      | its integration before a badge update | 1      |

  Scenario Outline: Refuse conflicting release state
    Given release creation encounters "<conflict>"
    When release creation is refused
    Then release automation reports "<reason>" with the source PR and commit
    And no release output or GitHub writes are produced

    Examples:
      | conflict                              | reason                      |
      | a hotfix reserving the version         | reserved by an active hotfix |
      | the branch at another commit          | different commit            |
      | an advanced source PR                 | no longer matches           |
      | only dependency badge changes         | outside dependency badges   |
      | already released content after squash | outside dependency badges |
      | a prepared branch with another tree   | different commit            |
      | main code changing after preparation  | dependency badges           |

  Scenario Outline: Preserve GitHub failure reasons and operation context
    Given GitHub rejects "<operation>" with HTTP 503
    When that release operation is attempted
    Then release automation reports "<reason>" and the GitHub failure
    And no release output is produced

    Examples:
      | operation                 | reason                                      |
      | listing releases          | Could not list pull requests targeting main |
      | opening the release PR    | Could not open release PR                   |

  Scenario Outline: Continue the exact release PR through validation and publication
    Given release PR "<branch>" is "<condition>" during "<operation>"
    When release PR orchestration runs
    Then the release PR is "<result>" with <writes> GitHub writes

    Examples:
      | branch         | condition                              | operation | result    | writes |
      | release/0.0.25 | open and valid                         | validate  | validated | 0      |
      | release/0.0.25 | an open draft                          | validate  | validated | 0      |
      | release/0.0.25 | already merged                         | validate  | confirmed | 0      |
      | release/0.0.25 | already merged with a delayed merge SHA | validate | confirmed | 0      |
      | release/0.0.25 | already merged                         | merge     | confirmed | 0      |
      | hotfix/0.0.25  | already merged                         | merge     | confirmed | 0      |
      | release/0.0.25 | already merged with newer badges       | merge     | confirmed | 0      |
      | release/0.0.25 | merged during validation               | validate  | confirmed | 0      |
      | release/0.0.25 | merged before the merge helper reads it | merge     | confirmed | 0      |
      | hotfix/0.0.25  | merged despite a merge command error    | merge     | confirmed | 1      |
      | hotfix/0.0.25  | awaiting merge confirmation            | merge     | confirmed | 1      |
      | release/0.0.25 | fast-forwarded by the merge helper      | merge     | confirmed | 1      |

  Scenario Outline: Refuse changed identities and unconfirmed release publication
    Given release PR orchestration encounters "<condition>" during "<operation>"
    When release PR orchestration runs
    Then release PR orchestration refuses "<reason>" with <writes> GitHub writes

    Examples:
      | condition                          | operation | reason                    | writes |
      | a source fork                      | validate  | identity changed          | 0      |
      | a target fork                      | merge     | identity changed          | 0      |
      | a changed source branch            | validate  | identity changed          | 0      |
      | a changed source commit            | merge     | identity changed          | 0      |
      | a changed target branch            | validate  | identity changed          | 0      |
      | a closed unmerged PR               | merge     | closed without merging    | 0      |
      | a draft PR                         | merge     | draft                     | 0      |
      | an invalid actual merge SHA        | merge     | valid actual merge SHA    | 0      |
      | a missing actual merge SHA         | merge     | Timed out                 | 0      |
      | a superseded merged release        | validate  | no longer current         | 0      |
      | a failed version validation        | validate  | already exists            | 0      |
      | a failed validation API            | validate  | gh: HTTP 503              | 0      |
      | an unavailable PR API              | validate  | gh: HTTP 503              | 0      |
      | a failed merge command             | merge     | gh: HTTP 503              | 1      |
      | a merge that remains unconfirmed    | merge     | Timed out                 | 1      |
      | an identity change while waiting   | merge     | identity changed          | 1      |
      | an unavailable confirmation API    | merge     | gh: HTTP 503              | 1      |

  Scenario Outline: Publish only the release currently on main
    Given main contains "<commit>"
    When production freshness is checked
    Then production publishing is "<decision>"

    Examples:
      | commit          | decision |
      | this release    | allowed  |
      | a newer release | refused  |
      | only newer dependency badges | allowed |
