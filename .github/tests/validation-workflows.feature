# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@validation-workflows
Feature: Carry complete validation through integration and release
  Reusing validation must retain its original evidence and publication gates.

  Scenario: Integration and dependency writes retain one global queue
    Then integration workflows share one retained queue without acquiring their own lock twice

  Scenario: Candidate inspection cannot obtain branch update credentials
    Then queued preparation separates proposed inspection code from branch update credentials

  Scenario Outline: Preparation gates every integration job
    Given the validation workflow for "<target>"
    Then an unprepared candidate cannot start any downstream integration job
    Examples:
      | target  |
      | develop |
      | release |
      | main    |
      | support |
      | docs    |

  Scenario Outline: A cache miss requires every suite before publishing proof
    Given the validation workflow for "<target>"
    When matching validation is "missing"
    Then all validation suites run before a new proof is published
    And exactly one fresh proof is published after all validation artifacts
    And release artifacts remain bound to the exact tested checkout
    And report badges are generated from passing results and travel with validated reports
    Examples:
      | target  |
      | release |
      | main    |

  Scenario Outline: A cache hit restores evidence without certifying a new run
    Given the validation workflow for "<target>"
    When matching validation is "available"
    Then validation suites and new proof creation are skipped
    And the verified artifacts and original report provenance are preserved
    Examples:
      | target  |
      | release |
      | main    |

  Scenario Outline: Reuse cannot bypass failed validation or publication guards
    Given the validation workflow for "<target>"
    Then reuse has read-only access and publication requires successful validation
    And failure diagnostics cannot substitute for successful validation proof
    Examples:
      | target  |
      | release |
      | main    |

  Scenario: A release waits for its versioned changelog
    Given the validation workflow for "main"
    Then the release application job waits for the changelog documentation PR

  Scenario: Develop integration builds previews without automatically running test suites
    Given the validation workflow for "develop"
    Then develop builds and merges without test execution or validation proof

  Scenario: Develop test suites require an explicit manual run on develop
    Then the manual develop workflow runs all suites only for the develop branch

  Scenario: Preparing a release from develop does not run test suites
    Given the validation workflow for "main"
    Then release preparation defers all suites until a release candidate exists

  Scenario: Retrying publication retains the successful validation producer attempt
    Given the validation workflow for "main"
    Then publication retries use the producing attempt rather than the retry attempt
