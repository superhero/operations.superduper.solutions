# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Gitflow validation and guarded merging
  Only supported branch routes and tested revisions may reach protected branches.
  Released versions remain reserved even while deployment is still tagging them.

  Scenario Outline: Pull requests follow the supported branch routes
    Given a repository without released versions or active release branches
    When Gitflow validates "<head>" into "<base>"
    Then Gitflow validation is "<outcome>"

    Examples:
      | head           | base    | outcome  |
      | feature/editor | develop | accepted |
      | main           | develop | accepted |
      | release/1.2.3  | main    | accepted |
      | develop        | main    | rejected |
      | other/editor   | develop | rejected |

  Scenario Outline: Release branches require plain numeric versions
    Given a repository without released versions or active release branches
    When Gitflow validates "release/<version>" into "main"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "SemVer"

    Examples:
      | version    |
      | 01.2.3     |
      | 1.2.3-rc.1 |

  Scenario Outline: Version reservations survive release and deployment transitions
    Given version "1.2.3" has "<reservation>"
    When Gitflow validates "release/1.2.3" into "<base>"
    Then Gitflow validation is "<outcome>"
    And the Gitflow error explains "<reason>"

    Examples:
      | reservation                         | base    | outcome  | reason                       |
      | a published tag                     | main    | rejected | already exists               |
      | a merged release awaiting its tag   | main    | rejected | already exists               |
      | an active hotfix with this version  | develop | rejected | Conflicting active           |
      | another active release              | develop | rejected | Conflicting active           |
      | a published tag                     | develop | accepted |                              |
      | unmerged changes after its release  | develop | rejected | outside its released version |

  Scenario: Release artifacts must include the current main branch
    Given main has commits missing from the release head
    When Gitflow validates "release/1.2.3" into "main"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "must include current main"

  Scenario Outline: Hotfix versions follow the latest tag reachable from the target line
    Given support line "support/1.x" contains "1.2.9" but not "2.0.0"
    When Gitflow validates "hotfix/<version>" into "support/1.x"
    Then Gitflow validation is "<outcome>"
    And the Gitflow error explains "<reason>"

    Examples:
      | version | outcome  | reason            |
      | 1.2.10  | accepted |                   |
      | 1.3.0   | rejected | expected '1.2.10' |

  Scenario Outline: Automatic merging rechecks the pull request after CI
    Given the validated pull request has "<state>" when merging starts
    When automatic merging runs
    Then automatic merging is "<outcome>"
    And the merge error explains "<reason>"

    Examples:
      | state                | outcome  | reason                            |
      | no changes           | accepted |                                   |
      | been closed          | rejected | State is closed                   |
      | become a draft       | rejected | Draft status is true              |
      | a different head     | rejected | Head changed                      |
      | a different target   | rejected | Base branch changed               |
      | a newer base commit  | rejected | Pull request base changed         |
      | a fork as its source | rejected | Head repository                   |
      | fallen behind main   | rejected | Main changed                      |

  Scenario: Unavailable version data cannot make a version available
    Given GitHub cannot list repository tags
    When Gitflow validates "release/1.2.3" into "main"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "Could not list repository tags"
    And the Gitflow error explains "GitHub unavailable"

  Scenario Outline: Merge failures identify the failed operation and preserve GitHub's reason
    Given GitHub fails while "<operation>"
    When automatic merging runs
    Then automatic merging is "rejected"
    And the merge error explains "<reason>"
    And the merge error explains "GitHub unavailable"

    Examples:
      | operation                  | reason                                     |
      | reading the pull request   | Could not read current pull request state   |
      | comparing main to the head | before merging                             |
      | submitting the merge       | GitHub could not merge the validated        |
