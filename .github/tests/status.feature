# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Publish release reports and report dependency versions

  Scenario Outline: Publish each release report at its stable R2 destination
    Given a status file for "<key>" with content type "text/html; charset=utf-8"
    When the status is published
    Then R2 receives the file at its configured destination

    Examples:
      | key                |
      | test-coverage.html |
      | test-report.html   |

  Scenario Outline: Publishing failures explain the destination without exposing credentials
    Given a status file for "test-coverage.html" with content type "text/html; charset=utf-8"
    And Cloudflare returns "<response>"
    When the status is published
    Then publishing fails with "<reason>" and destination context

    Examples:
      | response               | reason                          |
      | authentication failure | Cloudflare error 10000          |
      | unsuccessful response  | unsuccessful response           |
      | invalid JSON           | unsuccessful response           |

  Scenario Outline: Missing publishing inputs prevent any request
    Given a status file for "test-coverage.html" with content type "text/html; charset=utf-8"
    And the publishing input "<input>" is missing
    When the status is published
    Then publishing fails with "<reason>" and destination context
    And no publishing request was made

    Examples:
      | input                 | reason                           |
      | file                  | Status file does not exist       |
      | CLOUDFLARE_API_TOKEN   | CLOUDFLARE_API_TOKEN is missing   |
      | CLOUDFLARE_ACCOUNT_ID  | CLOUDFLARE_ACCOUNT_ID is missing  |

  Scenario Outline: Dependency checks report current branches without Cloudflare credentials
    Given the dependency registry reports "<state>"
    When dependency status is updated for "<branch>"
    Then the workflow reports "All dependencies are up to date." for that branch
    And temporary registry data is removed

    Examples:
      | branch  | state   |
      | main    | current |
      | develop | empty   |

  Scenario: Outdated dependencies show package versions in the workflow without failing the check
    Given the dependency registry reports "outdated"
    When dependency status is updated for "release/0.0.30"
    Then the workflow reports "2 outdated dependencies." for that branch
    And the workflow shows each outdated package with its current, wanted and latest versions
    And temporary registry data is removed

  Scenario: Dependency reports escape branch names in Markdown
    Given the dependency registry reports "current"
    When dependency status is updated for "feature/report|<preview>`tick"
    Then the workflow displays the branch name as escaped text
    And temporary registry data is removed

  Scenario: Invalid dependency versions do not produce a misleading report
    Given the dependency registry reports "missing version"
    When dependency status is updated for "main"
    Then invalid dependency data does not produce a successful report
    And no successful dependency report is written
    And temporary registry data is removed

  Scenario Outline: Registry failures explain the failing request safely
    Given the dependency registry reports "failure <exit>"
    When dependency status is updated for "main"
    Then the registry failure includes the branch and safe npm error summary
    And no successful dependency report is written
    And temporary registry data is removed

    Examples:
      | exit |
      | 1    |
      | 2    |

  Scenario: Non-JSON registry failures retain a bounded reason without credentials
    Given the dependency registry reports "failure without JSON"
    When dependency status is updated for "main"
    Then the registry failure reports sanitized stderr
    And no successful dependency report is written
    And temporary registry data is removed

  Scenario: Invalid dependency status branches are rejected before external requests
    Given the dependency registry reports "current"
    And the dependency branch name is invalid
    When dependency status is updated for "release/../main"
    Then the dependency status update fails with "Invalid dependency status branch" before external requests
    And no successful dependency report is written

  Scenario Outline: Dependency colours use the same registry check as the branch summary
    Given the dependency registry reports "<state>"
    And dependency badges will be refreshed with the registry check
    When dependency status is updated for "develop"
    Then the dependency badges reflect the same registry result
    And temporary registry data is removed

    Examples:
      | state    |
      | outdated |
      | current  |

  Scenario: Registry errors cannot replace dependency badge colours
    Given the dependency registry reports "failure 1"
    And dependency badges will be refreshed with the registry check
    When dependency status is updated for "main"
    Then the failed registry check creates no badges
    And no successful dependency report is written
