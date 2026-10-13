# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @changelog-document
Feature: Preserve commit messages through staging and release changelogs
  Each commit is identified by its full SHA. Staging contains unreleased work,
  while release sections retain the full messages previously published there.

  Scenario Outline: Preserve complete messages as literal text
    Given a changelog commit with a "<message>" message
    When that commit is staged and released as "1.2.3"
    Then the complete changelog message survives unchanged
    And the changelog includes a link to the full commit SHA
    And changelog message text has no executable side effects

    Examples:
      | message                  |
      | subject only             |
      | subject and body         |
      | Markdown and long fences |
      | shell substitutions      |
      | trailing newlines        |
      | indentation and Unicode  |

  Scenario Outline: Adding commits again does not duplicate or restage them
    Given a changelog commit already "<placement>"
    When the same changelog commit is added twice alongside a new commit
    Then each full commit SHA appears exactly once in the changelog
    And the original changelog commit remains "<placement>"
    And the new changelog commit remains in Staging

    Examples:
      | placement |
      | staged    |
      | released  |

  Scenario: Identical messages from separate commits retain separate identities
    Given two changelog commits have identical messages and different full SHAs
    When those changelog commits are staged
    Then both distinct commit identities remain in Staging

  Scenario Outline: Release preparation preserves prior versions and supports retries
    Given the changelog is ready for "<operation>"
    When the changelog is released as "<version>"
    Then Staging is the first changelog section and is empty
    And the changelog release sections contain "<sections>"
    And preparing that changelog release again makes no change

    Examples:
      | operation               | version | sections                  |
      | the first release       | 1.0.0   | 1.0.0:a                   |
      | the next release        | 1.1.0   | 1.1.0:b;1.0.0:a           |
      | extending a release     | 1.1.0   | 1.1.0:b,c;1.0.0:a         |
      | numeric version sorting | 1.10.0  | 1.10.0:c;1.9.0:b;1.0.0:a  |

  Scenario Outline: Merge release history with stale development Staging
    Given release and development changelogs share a released commit
    When the changelogs are merged with "<first>" first
    Then the released commit occurs only under its original version
    And new development work remains in Staging
    And merging the resulting changelog again makes no change

    Examples:
      | first       |
      | release     |
      | development |

  Scenario Outline: Initialize an absent changelog without inventing history
    Given the initial changelog text is "<initial>"
    When the changelog is merged without new commits
    Then the changelog contains only its title and empty Staging section

    Examples:
      | initial       |
      | absent        |
      | empty Staging |
      | legacy empty Staging |

  Scenario Outline: Ordinary Git merges never silently release new development work
    Given a Git changelog history with "<history>"
    When a release is merged into development with "<advance>"
    Then Git either preserves new work in Staging or reports a changelog conflict
    And the managed changelog merge preserves the correct release assignment

    Examples:
      | history            | advance                 |
      | a first release    | one new commit          |
      | a first release    | several new commits     |
      | prior releases     | one new commit          |
      | prior releases     | no new commits          |

  Scenario Outline: Reject malformed or manually authored content without dropping it
    Given changelog content contains "<problem>"
    When that changelog is updated
    Then changelog validation refuses it with "<reason>"
    And the rejected changelog input remains unchanged

    Examples:
      | problem                  | reason                            |
      | an unrelated title       | expected # Changelog              |
      | a missing Staging section| expected Staging                  |
      | authored prose           | refusing to discard authored      |
      | an unknown section       | SemVer                            |
      | duplicate versions       | duplicate version                 |
      | a repeated commit ID     | duplicate commit ID               |
      | a missing closing fence  | unclosed message fence            |
      | a shortened commit ID    | unrecognized content              |
      | a mismatched heading     | commit heading does not match     |
      | an unsafe message fence  | unsafe or noncanonical            |
      | a prefixed version       | SemVer                            |
      | a missing Staging boundary | missing Staging boundary       |
      | a repeated Staging boundary | duplicate or misplaced Staging |
      | an entry past Staging    | commit outside Staging boundary   |

  Scenario Outline: Refuse contradictory histories for the same full commit SHA
    Given changelog histories disagree about "<conflict>"
    When those conflicting changelog histories are merged
    Then changelog validation refuses it with "<reason>"

    Examples:
      | conflict             | reason                       |
      | commit messages      | conflicting messages         |
      | released versions    | conflicting release versions |
      | commit repositories  | conflicting repositories     |

  Scenario Outline: Reject unsupported release versions
    Given the changelog is ready for "the first release"
    When an invalid changelog release version "<version>" is requested
    Then changelog validation refuses it with "SemVer"

    Examples:
      | version      |
      | v1.2.3       |
      | 01.2.3       |
      | 1.2          |
      | 1.2.3-beta.1 |

  Scenario Outline: Reject incomplete commit records
    Given a changelog commit record has "<problem>"
    When that invalid changelog commit is added
    Then changelog validation refuses it with "<reason>"

    Examples:
      | problem           | reason                   |
      | a short SHA       | full lowercase SHA       |
      | an empty message  | nonempty message         |
      | a NUL message     | without NUL bytes        |
      | an unsafe slug    | owner/name slug          |
