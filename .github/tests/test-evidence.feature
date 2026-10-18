# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@test-evidence
Feature: Certify only complete Gherkin executions and coverage
  Synthetic files exercise the validator contract; they are never release evidence.

  Scenario: Complete execution evidence matches independently parsed feature identities
    Given a complete synthetic source execution
    When its execution evidence is checked
    Then the execution evidence is accepted

  Scenario Outline: Invalid execution evidence cannot certify validation
    Given a complete synthetic source execution
    And its evidence has "<defect>"
    When its execution evidence is checked
    Then the execution evidence is rejected
    Examples:
      | defect                         |
      | missing results                |
      | missing blob                   |
      | missing proof                  |
      | filtered run                   |
      | incomplete run                 |
      | nonzero exit                   |
      | stale commit                   |
      | wrong profile                  |
      | wrong project                  |
      | incomplete feature list        |
      | missing case                   |
      | duplicate case                 |
      | missing Gherkin metadata       |
      | mismatched result hash         |
      | mismatched blob hash           |
      | reversed timestamps            |
      | missing configuration identity |
      | altered configuration identity |
      | changed configuration input    |
      | changed installed version      |
      | mismatched recorded toolchain  |
      | blob missing case              |
      | blob extra case                |
      | blob wrong project             |
      | blob different steps           |
      | blob failed case               |
      | blob wrong feature path        |
      | blob run errors                |
      | blob unsupported version       |
      | another CI run                 |
      | another CI attempt             |
      | unsuccessful report            |
      | failed module                  |
      | skipped scenario               |
      | pending scenario               |
      | missing steps                  |
      | changed authored step text     |
      | added unauthored step          |
      | changed authored step line     |
      | unexecuted step                |
      | inconsistent totals            |

  Scenario Outline: Canonical identities preserve example row locations
    Given a Gherkin identity expressed as "<form>"
    When its canonical identity is read
    Then it identifies the repository feature and example row
    Examples:
      | form          |
      | relative path |
      | absolute path |
      | file URL      |

  Scenario Outline: Invalid identities cannot masquerade as repository cases
    Given a Gherkin identity expressed as "<form>"
    When its canonical identity is read
    Then the invalid identity is rejected
    Examples:
      | form               |
      | outside repository |
      | traversal path     |
      | dot path alias     |
      | missing location   |
      | invalid row        |

  Scenario: Unknown profiles cannot supply an expected case inventory
    Then unknown evidence profiles are rejected

  Scenario: Complete scoped coverage passes every threshold
    Given synthetic coverage with "all counters covered"
    When its coverage evidence is checked
    Then the coverage evidence is accepted

  Scenario Outline: Coverage cannot hide missing or unexecuted scope
    Given synthetic coverage with "<defect>"
    When its coverage evidence is checked
    Then the coverage evidence is rejected
    Examples:
      | defect                 |
      | missing metric         |
      | partial branch count   |
      | rounded percentage     |
      | skipped counter        |
      | unexecuted source      |
      | empty denominator      |
