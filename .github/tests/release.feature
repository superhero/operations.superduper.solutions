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
      | finding release artifacts | Could not list artifacts                    |

  Scenario Outline: Resolve a pushed release without confusing the develop trigger
    Given the pushed commit has a merged "<branch>" PR after a develop PR on another page
    When the pushed release is resolved
    Then only PR 124 and its validated "<branch>" head are returned

    Examples:
      | branch         |
      | release/0.0.25 |
      | hotfix/0.0.25  |

  Scenario Outline: Resolve a fast-forward without changing the tested artifact identity
    Given the pushed "<branch>" head is recognized as merged "<timing>"
    When the pushed release is resolved
    Then only PR 124 and its validated "<branch>" head are returned

    Examples:
      | branch         | timing                   |
      | release/0.0.25 | immediately              |
      | hotfix/0.0.25  | after a delay            |
      | release/0.0.25 | alongside an abandoned PR |

  Scenario Outline: Refuse an untrusted or ambiguous pushed release
    Given the pushed commit has "<association>"
    When the pushed release is refused
    Then release identity reports "<reason>" with the pushed commit
    And no release output or GitHub writes are produced

    Examples:
      | association                              | reason               |
      | a different merge commit                 | found 0              |
      | a fork PR                                | found 0              |
      | two matching PRs                         | found 2              |
      | two fast-forward candidates              | found 2              |
      | an unrecognized fast-forward             | Timed out            |
      | a fast-forward PR closed without merging | not a merged release |
      | an advanced fast-forward PR              | no longer identifies |
      | a recognition API failure                | Could not read PR    |

  Scenario Outline: Select only the tested release PR build
    Given a merged "<branch>" PR has these CI runs
      | id | event        | branch  | commit  | PR    |
      | 42 | pull_request | release | tested  | 124   |
      | 43 | pull_request | develop | tested  | 124   |
      | 44 | pull_request | release | other   | 124   |
      | 45 | pull_request | release | tested  | 999   |
      | 46 | push         | release | tested  | 124   |
    And release CI run 42 succeeded with all required artifacts
    When release artifacts are selected
    Then only release CI run 42 supplies artifacts

    Examples:
      | branch         |
      | release/0.0.25 |
      | hotfix/0.0.25  |

  Scenario: A deployment run cannot supply its own artifacts
    Given a merged "release/0.0.25" PR has these CI runs
      | id | event | branch  | commit | PR  |
      | 42 | push  | release | tested | 124 |
    When release artifact selection is refused
    Then artifact selection reports "Timed out" with the release and commit
    And no release output is produced

  Scenario: Never fall back to an older build when the newest run fails
    Given a merged "release/0.0.25" PR has these CI runs
      | id | event        | branch  | commit | PR  |
      | 41 | pull_request | release | tested | 124 |
      | 42 | pull_request | release | tested | 124 |
    And release CI run 42 finished with "failure"
    When release artifact selection is refused
    Then artifact selection reports "finished with failure" with the release and commit
    And no release output is produced

  Scenario Outline: Require every release artifact to remain available
    Given release CI succeeded but "<artifact>" is "<condition>"
    When release artifact selection is refused
    Then artifact selection reports "missing required artifacts: <artifact>" with the release and commit
    And no release output is produced

    Examples:
      | artifact    | condition |
      | bundle      | expired   |
      | coverage    | missing   |
      | test-report | missing   |

  Scenario: Wait for CI to appear and finish uploading its reports
    Given release CI appears after a delay and finishes on the next poll
    When release artifacts are selected
    Then only release CI run 42 supplies artifacts

  Scenario: Unmerged PRs cannot provide deployment artifacts
    Given the release PR has not merged
    When release artifact selection is refused
    Then artifact selection reports "not a merged release" with the release and commit
    And no release output is produced

  Scenario Outline: Publish only the release currently on main
    Given main contains "<commit>"
    When production freshness is checked
    Then production publishing is "<decision>"

    Examples:
      | commit          | decision |
      | this release    | allowed  |
      | a newer release | refused  |
      | only newer dependency badges | allowed |
