# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Documentation advances do not restart release publication
  Only a nonempty Markdown-only forward update to an existing release pull
  request may skip the full pipeline. Unverifiable comparisons stop routing.

  Scenario Outline: Route a release synchronization containing <change>
    Given a release synchronization contains "<change>"
    When the release update is classified
    Then the release pipeline is "<route>" without changing the trusted checkout

    Examples:
      | change                           | route   |
      | a Markdown edit                  | skipped |
      | a Markdown addition              | skipped |
      | a Markdown deletion              | skipped |
      | a Markdown rename                | skipped |
      | unusual Markdown filenames       | skipped |
      | more than 300 Markdown files     | skipped |
      | a forward documentation merge    | skipped |
      | application code                 | full    |
      | code beside documentation        | full    |
      | code after 300 Markdown files    | full    |
      | a code deletion                  | full    |
      | code renamed to Markdown         | full    |
      | Markdown renamed to code         | full    |
      | executable Markdown              | full    |
      | formerly executable Markdown     | full    |
      | deleted executable Markdown      | full    |
      | a Markdown symlink               | full    |
      | a replaced Markdown symlink      | full    |
      | a Markdown gitlink               | full    |
      | an empty commit                  | full    |
      | an unchanged head                | full    |
      | a documentation rewind           | full    |
      | rewritten documentation history  | full    |
      | removed application history      | full    |
      | unrelated documentation history  | full    |

  Scenario Outline: Stop routing an unverifiable release update with <problem>
    Given a release synchronization contains "a Markdown edit"
    And its release update has "<problem>"
    When the release update is classified
    Then the release pipeline is "blocked" without changing the trusted checkout

    Examples:
      | problem                   |
      | a missing previous SHA    |
      | a short previous SHA      |
      | a short head SHA          |
      | an invalid head SHA       |
      | an invalid source branch  |
      | an unsupported event      |
      | an extra argument         |
      | an unavailable previous head |
      | an unavailable head       |
      | a non-commit previous head |
      | a non-commit head          |
      | an unavailable before tree |
      | an unavailable head tree  |
      | an unavailable nested tree |
      | an unavailable changed blob |
      | an unavailable ancestor   |

  Scenario Outline: Run the full actual-head pipeline for <action> on <branch>
    Given a release synchronization contains "a Markdown edit"
    And its release event is "<action>" on "<branch>" without a previous head
    When the release update is classified
    Then the release pipeline is "full" without changing the trusted checkout

    Examples:
      | action           | branch        |
      | opened           | release/1.2.3 |
      | reopened         | release/1.2.3 |
      | edited           | release/1.2.3 |
      | ready_for_review | release/1.2.3 |
      | synchronize      | hotfix/1.2.3  |
      | synchronize      | develop       |

  Scenario: A failed fetch cannot approve a documentation-only release update
    Given a release synchronization contains "a Markdown edit"
    And its trusted release classifier is available
    And its pinned release objects cannot be fetched
    When the release update objects are fetched
    Then release update routing stops before classification

  Scenario Outline: Bootstrap <action> on <branch> before trusted main supports release routing
    Given a release synchronization contains "a Markdown edit"
    And only the proposed release contains a classifier
    And its release event is "<action>" on "<branch>" without a previous head
    When the release routing workflow steps execute
    Then the release pipeline is "full" without changing the trusted checkout

    Examples:
      | action      | branch        |
      | opened      | develop       |
      | synchronize | develop       |
      | opened      | release/1.2.3 |
      | synchronize | release/1.2.3 |

  Scenario: Trusted routing still rejects malformed synchronization after bootstrap
    Given a release synchronization contains "a Markdown edit"
    And its trusted release classifier is available
    And its release event is "synchronize" on "release/1.2.3" without a previous head
    When the release routing workflow steps execute
    Then the release pipeline is "blocked" without changing the trusted checkout
