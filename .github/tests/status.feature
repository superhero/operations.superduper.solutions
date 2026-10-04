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

  Scenario Outline: Dependency badges reflect the registry result
    Given dependency data that is "<state>"
    When dependency badges are generated
    Then the dependency summary says "<message>" in "<color>"
    And the scoped package badge uses its stable filename and "<package color>" color

    Examples:
      | state    | message     | color       | package color |
      | current  | up to date  | brightgreen | blue          |
      | outdated | 1 outdated  | orange      | orange        |

  Scenario Outline: Invalid dependency data produces no misleading badges
    Given dependency data that is "<state>"
    When dependency badges are generated
    Then badge generation fails with "<reason>" and input paths
    And no dependency badges are written

    Examples:
      | state             | reason                                  |
      | registry error    | npm error E401: authentication failed   |
      | missing version   | did not return valid dependency data   |
      | invalid manifest  | devDependencies object with string versions |
