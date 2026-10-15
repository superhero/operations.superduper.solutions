# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @integration-queue
Feature: Integration validates the revision selected when its queue slot starts
  Queued runs use the current target without replacing their event source.
  Development candidates refresh before testing; synchronization sources retain
  their released history. Obsolete events do not waste validation work.

  Scenario Outline: Refresh a development candidate that missed a target advance
    Given a queued integration from "<source>" into "<target>" in "merge" mode
    When the integration queue slot is prepared
    Then integration preparation requests a source refresh without running validation

    Examples:
      | source        | target        |
      | feature/topic | develop       |
      | bugfix/topic  | develop       |
      | bugfix/topic  | release/1.2.3 |

  Scenario: An already refreshed candidate validates against its current target
    Given a queued integration from "feature/topic" into "develop" in "merge" mode
    And its event source already contains the current target
    When the integration queue slot is prepared
    Then integration preparation pins the current proposed merge

  Scenario: A fork candidate is validated without requesting a source update
    Given a queued integration from "feature/topic" into "develop" in "merge" mode
    And its queued integration has "a fork source repository"
    When the integration queue slot is prepared
    Then integration preparation pins the current proposed merge

  Scenario Outline: Synchronization must not import unreleased target work into its source
    Given a queued integration from "<source>" into "<target>" in "merge" mode
    When the integration queue slot is prepared
    Then integration preparation pins the current proposed merge

    Examples:
      | source        | target        |
      | main          | develop       |
      | release/1.2.3 | develop       |
      | hotfix/1.2.4  | develop       |
      | hotfix/1.2.4  | release/1.3.0 |
      | hotfix/1.2.4  | support/1.2   |

  Scenario Outline: Head validation retains its source and uses the latest target
    Given a queued integration from "<source>" into "<target>" in "<mode>" mode
    When the integration queue slot is prepared
    Then integration preparation pins the unchanged source

    Examples:
      | source        | target        | mode |
      | release/1.2.3 | main          | head |
      | hotfix/1.2.4  | main          | head |
      | develop       | main          | head |
      | docs/topic    | develop       | docs |
      | docs/topic    | release/1.2.3 | docs |
      | docs/topic    | main          | docs |

  Scenario: Release preparation retains its existing changelog conflict handling
    Given a queued integration from "develop" into "main" in "head" mode
    And its queued integration has "an actual merge conflict"
    When the integration queue slot is prepared
    Then integration preparation pins the unchanged source

  Scenario Outline: Skip an obsolete event before validation or branch mutation
    Given a queued integration from "feature/topic" into "develop" in "merge" mode
    And its queued integration has "<condition>"
    When the integration queue slot is prepared
    Then integration preparation skips the obsolete event

    Examples:
      | condition                     |
      | a closed PR                   |
      | a closed PR with a deleted fork |
      | an already merged PR          |
      | a draft PR                    |
      | a superseded event head       |
      | a newer canonical source ref  |
      | a title or description edit   |
      | a source change during lookup |
      | a closed PR during lookup     |

  Scenario: Retargeting a PR still prepares integration
    Given a queued integration from "main" into "develop" in "merge" mode
    And its queued integration has "a changed base branch event"
    When the integration queue slot is prepared
    Then integration preparation pins the current proposed merge

  Scenario Outline: Recheck synchronization after resolving its proposed merge
    Given a queued integration from "main" into "develop" in "merge" mode
    And its queued integration has "<condition>"
    When the integration queue slot is prepared
    Then integration preparation skips the obsolete event

    Examples:
      | condition                     |
      | a source change during lookup |
      | a closed PR during lookup     |

  Scenario Outline: Stop on unverifiable integration inputs
    Given a queued integration from "main" into "develop" in "merge" mode
    And its queued integration has "<condition>"
    When the integration queue slot is prepared
    Then integration preparation fails with "<message>"

    Examples:
      | condition                       | message                             |
      | a mismatched PR identity         | identity or metadata                |
      | an invalid canonical target ref  | invalid canonical branch ref        |
      | an actual merge conflict         | resolve them against the latest     |
      | unavailable mergeability         | not produced a mergeable revision   |
      | reversed merge parents           | exact live target and event head    |
      | a merge for the old target       | exact live target and event head    |
      | an unrelated proposed commit     | exact live target and event head    |
      | a target change during lookup    | target changed during               |
      | an exhausted overall read budget | exceeded its read budget            |

  Scenario: A malformed ancestry response cannot request a branch refresh
    Given a queued integration from "feature/topic" into "develop" in "merge" mode
    And its queued integration has "an invalid ancestry comparison"
    When the integration queue slot is prepared
    Then integration preparation fails with "invalid ancestry comparison"

  Scenario: GitHub may finish generating its proposed merge after the first read
    Given a queued integration from "main" into "develop" in "merge" mode
    And its queued integration has "temporarily unknown mergeability"
    When the integration queue slot is prepared
    Then integration preparation pins the current proposed merge

  Scenario: A queued base advance can briefly leave an outdated proposed merge
    Given a queued integration from "main" into "develop" in "merge" mode
    And its queued integration has "temporarily stale proposed merge parents"
    When the integration queue slot is prepared
    Then integration preparation pins the current proposed merge

  Scenario Outline: Retry only bounded transient GitHub reads
    Given a queued integration from "main" into "develop" in "merge" mode
    And integration API reads fail with "<failure>" for <attempts> attempts
    When the integration queue slot is prepared
    Then integration API retry handling is "<outcome>" after <calls> attempts

    Examples:
      | failure       | attempts | outcome | calls |
      | timeout       | 2        | ready   | 3     |
      | network       | 2        | ready   | 3     |
      | server        | 2        | ready   | 3     |
      | timeout       | 3        | blocked | 3     |
      | authorization | 3        | blocked | 1     |
      | rate_limit    | 3        | blocked | 1     |
      | not_found     | 3        | blocked | 1     |

  Scenario Outline: An explicit merged release rerun can finish publication
    Given a queued integration from "<source>" into "main" in "head" mode
    And its queued integration has "an explicit merged release retry"
    And its merged release retry has "a deleted source branch"
    When the integration queue slot is prepared
    Then integration preparation resumes only the confirmed release publication

    Examples:
      | source        |
      | release/1.2.3 |
      | hotfix/1.2.4  |

  Scenario Outline: Closed PRs outside explicit exact release recovery remain skipped
    Given a queued integration from "release/1.2.3" into "main" in "head" mode
    And its queued integration has "an explicit merged release retry"
    And its merged release retry has "<condition>"
    When the integration queue slot is prepared
    Then integration preparation skips the obsolete event

    Examples:
      | condition                            |
      | only its original run                |
      | a closed but unmerged PR              |
      | a different source revision          |
      | a development synchronization route   |
      | a non-release source                 |
      | a fork source                        |

  Scenario Outline: Release retry metadata must establish the exact confirmed merge
    Given a queued integration from "release/1.2.3" into "main" in "head" mode
    And its queued integration has "an explicit merged release retry"
    And its merged release retry has "<condition>"
    When the integration queue slot is prepared
    Then integration preparation fails with "confirmed merge of this exact event"

    Examples:
      | condition                    |
      | no confirmed merge timestamp |
      | an invalid merge timestamp   |
      | an invalid merged commit     |
      | no original event base       |
      | a mismatched PR route        |

  Scenario Outline: Fresh merged inputs cannot certify workflow instructions this run did not execute
    Given a queued integration from "main" into "develop" in "merge" mode
    And its queued integration has "<condition>"
    When the integration queue slot is prepared
    Then integration preparation fails with "fresh workflow event"

    Examples:
      | condition                                    |
      | a caller workflow change in the new target    |
      | a reusable workflow change in the new target  |
      | a symbolic workflow file                     |
      | an executable workflow file                  |
      | a submodule workflow entry                   |
      | a truncated workflow tree                    |
      | a missing workflow entry                     |
      | a duplicate workflow entry                   |
      | an invalid workflow blob SHA                 |
      | an incorrect workflow tree SHA               |

  Scenario: The environment CLI publishes all integration outputs without writes
    Given a queued integration from "main" into "develop" in "merge" mode
    When the integration environment CLI prepares its queue slot
    Then the integration CLI publishes the verified merge inputs

  Scenario: API diagnostics never expose command output or credentials
    Given a queued integration from "main" into "develop" in "merge" mode
    When the integration environment CLI receives an API authorization failure
    Then the integration CLI fails without publishing inputs or exposing credentials
