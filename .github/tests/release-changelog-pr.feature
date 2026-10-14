# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @release-changelog-pr
Feature: Review release changelog versions in a separate docs PR
  Release preparation preserves Latest. A metadata-only docs PR versions it
  before the exact release head may proceed to main.

  Scenario: Open a versioning PR without changing the release snapshot
    Given a release awaiting changelog review
    When the release workflow prepares its changelog docs PR
    Then a changelog-only PR targets the release with every entry preserved
    And the release snapshot remains unchanged
    And the workflow receives a pending changelog PR output

  Scenario: Retry the same open changelog PR
    Given a release awaiting changelog review
    And its generated changelog docs PR is open
    When its changelog docs PR is prepared
    Then the same changelog PR and commit are reused

  Scenario: Recover a generated branch without a PR
    Given a release awaiting changelog review
    And its generated changelog branch exists without a PR
    When its changelog docs PR is prepared
    Then a changelog-only PR targets the release with every entry preserved

  Scenario: Refresh an open PR when more release changes accumulate
    Given a release awaiting changelog review
    And its generated changelog docs PR is open
    And another change accumulates on the release
    When its changelog docs PR is prepared
    Then the changelog PR refreshes to include the new release entry
    And the release snapshot remains unchanged

  Scenario: Proceed only after versioning is merged into the release
    Given a release awaiting changelog review
    And its generated changelog docs PR has merged
    When its changelog docs PR is prepared
    Then the canonical release changelog is ready without writes

  Scenario: Open another review after an earlier versioning PR merged
    Given a release awaiting changelog review
    And its generated changelog docs PR has merged
    And another change accumulates on the release
    When its changelog docs PR is prepared
    Then the changelog PR refreshes to include the new release entry

  Scenario Outline: Refuse unexpected docs branch or PR work
    Given a release awaiting changelog review
    And its changelog review encounters "<condition>"
    When changelog review preparation is refused
    Then changelog review reports "<reason>" without changing branches

    Examples:
      | condition                         | reason                            |
      | unrelated branch work             | unexpected work                   |
      | a manually edited generated branch | unexpected work                  |
      | an unrelated docs PR               | unexpected ownership or target    |
      | a closed unmerged docs PR          | closed without merging            |
      | a release advancing before publication | release PR changed           |
      | a docs PR head that changed        | docs PR head changed              |

  Scenario: Protect concurrent changes to the generated docs branch
    Given a release awaiting changelog review
    And its generated changelog docs PR is open
    When another writer advances the docs branch before publication
    Then publishing with the stale docs branch lease is refused
