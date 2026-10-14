# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Preserve complete source commit messages before develop squashes
  Preparation changes only the source changelog and triggers a new validated head.
  The target branch and the original source history remain unchanged.

  Scenario: A preparation commit records full messages and retries without a loop
    Given a changelog source with full commit messages
    When the source changelog is prepared
    Then a single changelog commit extends the exact source head
    And every full source message is preserved
    When preparation retries at the generated head
    Then preparation reports that no source update is needed

  Scenario Outline: Earlier generated commits never enter the changelog during migration
    Given a changelog source with full commit messages
    And an earlier "<format>" generated changelog commit precedes more source work
    When the source changelog is prepared
    Then a single changelog commit extends the exact source head
    And every full source message is preserved
    And the earlier generated changelog commit is excluded
    When preparation retries at the generated head
    Then preparation reports that no source update is needed

    Examples:
      | format  |
      | Latest  |
      | Staging |
      | Release |

  Scenario Outline: Preparation refuses stale or ineligible pull requests without changing refs
    Given a changelog source with full commit messages
    And changelog preparation encounters "<state>"
    When the source changelog is prepared
    Then preparation rejects the update without changing either branch

    Examples:
      | state                           |
      | stale PR head                   |
      | stale PR base                   |
      | mismatched source branch        |
      | mismatched base branch          |
      | forked source                   |
      | draft source                    |
      | closed source                   |
      | stale live source               |
      | stale live base                 |
      | source changes before push      |
      | base changes before push        |
      | source races the push lease     |

  Scenario Outline: A manual metadata-looking commit is preserved
    Given a changelog source with full commit messages
    And a commit with the "<format>" generated trailer changes application content
    When the source changelog is prepared
    Then every full source message is preserved

    Examples:
      | format  |
      | Latest  |
      | Staging |
      | Release |

  Scenario: A merge commit with release metadata preserves its message
    Given a changelog source with full commit messages
    And a changelog-only merge commit has the release generated trailer
    When the source changelog is prepared
    Then every full source message is preserved

  Scenario: Preparation includes more than one API page of commit history
    Given a changelog source with 251 small commits
    When the source changelog is prepared
    Then every full source message is preserved

  Scenario: Workflow gating reruns the changed head before application tests and merging
    Then develop changelog preparation is isolated from heavy tests and safely gated
