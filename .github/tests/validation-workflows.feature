# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@validation-workflows
Feature: Carry complete validation through integration and release
  Reusing validation must retain its original evidence and publication gates.

  Scenario Outline: A cache miss requires every suite before publishing proof
    Given the validation workflow for "<target>"
    When matching validation is "missing"
    Then all validation suites run before a new proof is published
    And exactly one fresh proof is published after all validation artifacts
    And release artifacts remain bound to the exact tested checkout
    Examples:
      | target  |
      | develop |
      | release |
      | main    |

  Scenario Outline: A cache hit restores evidence without certifying a new run
    Given the validation workflow for "<target>"
    When matching validation is "available"
    Then validation suites and new proof creation are skipped
    And the verified artifacts and original report provenance are preserved
    Examples:
      | target  |
      | develop |
      | release |
      | main    |

  Scenario Outline: Reuse cannot bypass failed validation or publication guards
    Given the validation workflow for "<target>"
    Then reuse has read-only access and publication requires successful validation
    And failure diagnostics cannot substitute for successful validation proof
    Examples:
      | target  |
      | develop |
      | release |
      | main    |

  Scenario: A release waits for its versioned changelog
    Given the validation workflow for "main"
    Then the release application job waits for the changelog documentation PR
