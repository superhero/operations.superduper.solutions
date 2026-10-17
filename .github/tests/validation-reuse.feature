# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@validation-reuse
Feature: Reuse complete validation only for trusted identical inputs

  Scenario Outline: Exact inputs preserve the original tested commit and reports
    Given a completed validation run with "<condition>"
    When matching validation artifacts are requested
    Then validation is "reused" with the original provenance

    Examples:
      | condition                          |
      | identical inputs                   |
      | a proposed merge checkout          |
      | a shallow proposed merge checkout  |
      | independently valid release notes  |
      | a successful main workflow         |
      | paginated validation artifacts     |
      | an older complete validation       |

  Scenario Outline: Relevant changes require fresh tests
    Given a completed validation run with "<condition>"
    When matching validation artifacts are requested
    Then validation is "fresh" with the original provenance

    Examples:
      | condition                 |
      | changed source            |
      | changed dependencies      |
      | changed lockfile          |
      | changed tests             |
      | changed workflow          |
      | changed toolchain         |
      | changed documentation     |
      | changed dependency badges |
      | changed file mode         |

  Scenario Outline: Incomplete or untrusted proof falls back without artifact publication
    Given a completed validation run with "<condition>"
    When matching validation artifacts are requested
    Then validation is "fresh" with the original provenance

    Examples:
      | condition                          |
      | a fork run                         |
      | another repository                 |
      | another workflow                   |
      | a previous develop workflow        |
      | another event                      |
      | a failed run                       |
      | incomplete artifact pagination     |
      | a missing bundle artifact          |
      | a missing manifest artifact        |
      | an expired coverage artifact       |
      | a duplicate report artifact        |
      | an artifact from another run       |
      | an old manifest attempt            |
      | a manifest for another source      |
      | an unrelated tested commit         |
      | a forged input fingerprint         |
      | an incomplete remote tree          |
      | a corrupt bundle                   |
      | an incomplete coverage report      |
      | a missing combined report          |
      | a missing report badge             |
      | a modified report badge            |
      | an extra artifact file             |
      | a prototype-named artifact file    |
      | an extra empty artifact directory  |
      | a symlink in the bundle            |
      | an unavailable artifact download   |
      | a rerun during download            |
      | an unavailable GitHub API          |

  Scenario Outline: Excluding release notes never accepts invalid managed content
    Given a completed validation run with "<condition>"
    When matching validation artifacts are requested
    Then the invalid validation request is rejected

    Examples:
      | condition                     |
      | malformed release notes       |
      | executable release notes      |
      | symlink release notes         |

  Scenario: A modified checkout cannot produce validation proof
    Given a completed validation run with "a modified tracked checkout"
    When complete validation provenance is recorded
    Then the invalid validation request is rejected

  Scenario: A missing report cannot produce validation proof
    Given a completed validation run with "a missing combined report"
    When complete validation provenance is recorded
    Then the invalid validation request is rejected

  Scenario Outline: A slow lookup leaves time for fresh validation
    Given a completed validation run with "<condition>"
    When matching validation artifacts are requested
    Then validation is "fresh" with the original provenance
    And the lookup stops safely at its runtime bound

    Examples:
      | condition                                  |
      | budget exhaustion before a matching run    |
      | budget exhaustion during artifact download |
      | too many candidates before a matching run   |

  Scenario Outline: Transient remote reads recover without changing validation evidence
    Given a completed validation run with "identical inputs"
    And validation remote reads encounter "<failure>"
    When matching validation artifacts are requested
    Then validation is "<outcome>" with the original provenance
    And remote retries preserve the shared budget and clean artifacts

    Examples:
      | failure                               | outcome |
      | two API timeouts                      | reused  |
      | one API network interruption          | reused  |
      | repeated API server failures          | fresh   |
      | API authorization failure             | fresh   |
      | missing API resource                  | fresh   |
      | API rate limit                        | fresh   |
      | malformed API response                | fresh   |
      | invalid proof after API recovery      | fresh   |
      | shrinking budget after two timeouts   | reused  |
      | retry wait exhausts the budget        | fresh   |
      | interrupted artifact download         | reused  |
      | repeated artifact interruptions       | fresh   |
