# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Discover every branch for scheduled dependency checks

  Scenario: Dependency branch discovery includes every page and pins each branch revision
    Given the dependency branch API returns multiple pages
    When dependency branches are discovered
    Then the dependency matrix contains every branch and its commit

  Scenario: Dependency branch discovery explains GitHub failures without credentials
    Given the dependency branch API fails
    When dependency branches are discovered
    Then dependency branch discovery fails with "Could not list repository branches: HTTP 403: denied [REDACTED]"

  Scenario Outline: Dependency branch discovery rejects unusable API responses
    Given the dependency branch API returns "<data>"
    When dependency branches are discovered
    Then dependency branch discovery fails with "<reason>"

    Examples:
      | data           | reason                              |
      | malformed JSON | GitHub returned invalid branch data |
      | empty          | No branches were returned           |
      | invalid SHA    | GitHub returned invalid branch data |
      | invalid ref    | GitHub returned an invalid branch name |

  Scenario: Dependency branch discovery never silently drops branches at the matrix limit
    Given the dependency branch API returns "257 branches"
    When dependency branches are discovered
    Then dependency branch discovery fails with "Found 257 branches; GitHub Actions supports at most 256 jobs in a matrix"
