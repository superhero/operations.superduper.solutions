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
      | only badge changes after its release | develop | accepted |                             |

  Scenario: Release artifacts must include the current main branch
    Given main has commits missing from the release head
    When Gitflow validates "release/1.2.3" into "main"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "must include current main"

  Scenario Outline: Released hotfixes synchronize without republishing their version
    Given hotfix "1.2.4" was released "<reservation>"
    When Gitflow validates "hotfix/1.2.4" into "<base>"
    Then Gitflow validation is "<outcome>"
    And the Gitflow error explains "<reason>"

    Examples:
      | reservation      | base          | outcome  | reason         |
      | with a tag       | release/1.3.0 | accepted |                |
      | awaiting its tag | release/1.3.0 | accepted |                |
      | with a tag       | support/1.x   | accepted |                |
      | awaiting its tag | support/1.x   | accepted |                |
      | with a tag       | develop       | accepted |                |
      | awaiting its tag | develop       | accepted |                |
      | with a tag       | main          | rejected | already exists |
      | awaiting its tag | main          | rejected | already exists |

  Scenario Outline: Hotfix synchronization requires an unreleased release target
    Given hotfix "1.2.4" was released "<reservation>"
    And the hotfix release target is "<target>"
    When Gitflow validates "hotfix/1.2.4" into "<base>"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "<reason>"

    Examples:
      | reservation      | target | base           | reason         |
      | with a tag       | tagged | release/1.3.0  | already exists |
      | with a tag       | merged | release/1.3.0  | already exists |
      | awaiting its tag | merged | release/1.3.0  | already exists |
      | with a tag       | active | release/01.3.0 | SemVer         |

  Scenario Outline: Released hotfix synchronization accepts only released code and later badges
    Given hotfix "1.2.4" was released "<reservation>"
    And the released hotfix has later "<changes>" changes
    When Gitflow validates "hotfix/1.2.4" into "<base>"
    Then Gitflow validation is "<outcome>"
    And the Gitflow error explains "<reason>"

    Examples:
      | reservation      | base          | changes | outcome  | reason                       |
      | with a tag       | release/1.3.0 | code    | rejected | outside its released version |
      | awaiting its tag | support/1.x   | code    | rejected | outside its released version |
      | awaiting its tag | release/1.3.0 | badge   | accepted |                              |
      | with a tag       | support/1.x   | badge   | accepted |                              |

  Scenario Outline: Released hotfixes cannot import another release line into support
    Given hotfix "2.0.1" was released "with a tag"
    And the support target has "<line>"
    When Gitflow validates "hotfix/2.0.1" into "support/1.x"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "<reason>"

    Examples:
      | line                 | reason                      |
      | another release line | expected '1.2.10'            |
      | no released base     | No released tag is reachable |

  Scenario Outline: Hotfix synchronization fails closed when GitHub cannot verify it
    Given hotfix "1.2.4" was released "with a tag"
    And GitHub fails during hotfix synchronization "<operation>"
    When Gitflow validates "hotfix/1.2.4" into "<base>"
    Then Gitflow validation is "rejected"
    And the Gitflow error explains "<reason>"
    And the Gitflow error explains "GitHub unavailable"

    Examples:
      | operation          | base          | reason                          |
      | target lookup      | release/1.3.0 | reserving target release        |
      | source comparison  | release/1.3.0 | validate release synchronization |
      | support comparison | support/1.x   | determine the hotfix patch line  |

  Scenario: Dependency badge updates on main do not block release validation
    Given main only has dependency badge commits missing from the release head
    When Gitflow validates "release/1.2.3" into "main"
    Then Gitflow validation is "accepted"

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
      | newer base dependency badges | accepted |                              |
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
