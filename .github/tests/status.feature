# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Publish useful release and dependency status

  Scenario Outline: Publish the original file at its stable R2 destination
    Given a status file for "<key>" with content type "<type>"
    When the status is published
    Then R2 receives the file at its configured destination

    Examples:
      | key                | type                     |
      | coverage.json      | application/json         |
      | test-coverage.html | text/html; charset=utf-8 |

  Scenario Outline: Publishing failures explain the destination without exposing credentials
    Given a status file for "coverage.json" with content type "application/json"
    And Cloudflare returns "<response>"
    When the status is published
    Then publishing fails with "<reason>" and destination context

    Examples:
      | response               | reason                          |
      | authentication failure | Cloudflare error 10000          |
      | unsuccessful response  | unsuccessful response           |
      | invalid JSON           | unsuccessful response           |

  Scenario Outline: Missing publishing inputs prevent any request
    Given a status file for "coverage.json" with content type "application/json"
    And the publishing input "<input>" is missing
    When the status is published
    Then publishing fails with "<reason>" and destination context
    And no publishing request was made

    Examples:
      | input                 | reason                           |
      | file                  | Status file does not exist       |
      | CLOUDFLARE_API_TOKEN   | CLOUDFLARE_API_TOKEN is missing   |
      | CLOUDFLARE_ACCOUNT_ID  | CLOUDFLARE_ACCOUNT_ID is missing  |

  Scenario Outline: The dependency summary reflects the registry result
    Given dependency data that is "<state>"
    When the dependency summary is generated
    Then the dependency summary says "<message>" in "<color>"

    Examples:
      | state            | message     | color       |
      | current          | up to date  | brightgreen |
      | outdated         | 1 outdated  | orange      |
      | several outdated | 2 outdated  | orange      |

  Scenario Outline: Invalid dependency data produces no misleading summary
    Given dependency data that is "<state>"
    When the dependency summary is generated
    Then summary generation fails with "<reason>" and input paths
    And no dependency summary is written

    Examples:
      | state             | reason                                  |
      | registry error    | npm error E401: authentication failed   |
      | missing version   | did not return valid dependency data   |
      | invalid manifest  | devDependencies object with string versions |

  Scenario Outline: Scheduled dependency refreshes publish one summary to each branch's destination
    Given the dependency registry reports "current"
    When dependency status is updated for "<branch>"
    Then only the current dependency summary is published under "<prefix>"
    And temporary registry data is removed

    Examples:
      | branch  | prefix   |
      | main    |          |
      | develop | develop/ |

  Scenario: Outdated packages do not prevent dependency status publication
    Given the dependency registry reports "outdated"
    When dependency status is updated for "main"
    Then the published dependency summary says "1 outdated"
    And temporary registry data is removed

  Scenario: An empty successful registry response means dependencies are current
    Given the dependency registry reports "empty"
    When dependency status is updated for "develop"
    Then only the current dependency summary is published under "develop/"
    And temporary registry data is removed

  Scenario Outline: Registry failures stop publication and explain the failing request safely
    Given the dependency registry reports "failure <exit>"
    When dependency status is updated for "main"
    Then the registry failure includes the branch and safe npm error summary
    And temporary registry data is removed

    Examples:
      | exit |
      | 1    |
      | 2    |

  Scenario: Non-JSON registry failures retain a bounded reason without credentials
    Given the dependency registry reports "failure without JSON"
    When dependency status is updated for "main"
    Then the registry failure reports sanitized stderr without publishing
    And temporary registry data is removed

  Scenario: Invalid dependency status branches are rejected before external requests
    Given the dependency registry reports "current"
    When dependency status is updated for "release/0.0.30"
    Then the dependency status update fails with "Unsupported dependency status branch" before external requests
