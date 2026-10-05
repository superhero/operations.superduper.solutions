# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Dependency version badges travel with their branch

  Scenario: README dependency images point to the badges committed in this revision
    Then the README links every manifest dependency to its existing local version badge

  Scenario: Branches display the dependency versions in their own manifests
    Given branch manifests with different dependency versions
    When local version badges are generated for each branch
    Then each branch badge displays its own version without a registry request

  Scenario: Checking a changed manifest fails without rewriting badges
    Given generated local version badges
    When a dependency version changes in the manifest
    And local version badges are checked
    Then the check reports a stale badge with regeneration instructions without changing files
    When local version badges are regenerated and checked
    Then the local badge check succeeds with the updated version

  Scenario: Checking missing badges leaves the output directory absent
    Given a package manifest without local version badges
    When local version badges are checked
    Then the check reports missing badges with regeneration instructions without creating files

  Scenario: Removed dependencies remove only their generated badges
    Given generated local version badges and an unrelated SVG
    When a dependency is removed from the manifest
    And local version badges are checked
    Then the check reports the obsolete badge without deleting it
    When local version badges are regenerated and checked
    Then obsolete dependency badges are removed and the unrelated SVG remains

  Scenario: Version ranges are escaped safely in SVG text and attributes
    Given a dependency version containing XML special characters
    When local version badges are generated
    Then the badge contains escaped version text and accessible labels

  Scenario: Invalid manifests cannot write unsafe or misleading badges
    Then local version badge generation rejects these manifest problems without writing files:
      | problem                    |
      | malformed JSON             |
      | non-string version         |
      | filename traversal         |
      | package control characters |
      | scoped filename collision  |
      | version control characters |

  Scenario: Supplied latest versions colour only outdated declared dependencies orange
    Given declared dependencies with supplied outdated metadata
    When local badges are generated from the supplied outdated metadata
    Then only declared dependencies behind latest are orange without a registry request

  Scenario: Ordinary checks and generation preserve only canonical orange badges
    Given generated orange local version badges
    When local version badges are checked
    Then local version badges remain orange and unchanged
    When local version badges are generated
    Then local version badges remain orange and unchanged
    When the orange badge content is modified
    And local version badges are checked
    Then the check reports a stale badge with regeneration instructions without changing files

  Scenario: A fresh current observation clears a previous orange badge
    Given generated orange local version badges
    When fresh metadata reports the declared version is current
    Then the dependency badge is blue

  Scenario: Changing a displayed version resets a previous orange badge to blue
    Given generated orange local version badges
    When a dependency version changes in the manifest
    And local version badges are regenerated and checked
    Then the local badge check succeeds with the updated version
    And the dependency badge is blue

  Scenario: Invalid registry metadata cannot change existing local badges
    Given generated orange local version badges
    Then invalid outdated metadata is rejected without changing badges:
      | problem                    |
      | malformed JSON             |
      | multiple JSON objects      |
      | array instead of object    |
      | missing wanted version     |
      | non-string latest version  |
      | version control characters |
      | npm error response         |

  Scenario: Symlink badge output cannot touch files outside its directory
    Then badge generation refuses symlink outputs without changing their targets
