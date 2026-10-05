# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Dependency badge commits preserve the checked branch head

  Scenario: Unchanged dependency badges require no remote request
    Given a pinned checkout without dependency badge changes
    When dependency badges are published
    Then publication reports no commit and makes no remote request

  Scenario: A dependency badge commit contains only changed badge files
    Given a pinned checkout with dependency badge changes
    When dependency badges are published
    Then publication sends only changed added and deleted badges with an expected head
    And publication reports its commit URL without changing the checkout

  Scenario Outline: A stale dependency observation cannot overwrite a branch
    Given a pinned checkout with dependency badge changes
    And the publication branch is "<state>"
    When dependency badges are published
    Then publication skips the "<state>" branch without creating a commit

    Examples:
      | state    |
      | advanced |
      | deleted  |

  Scenario Outline: Publication failures retain useful diagnostics
    Given a pinned checkout with dependency badge changes
    And the badge publication API fails during "<operation>"
    When dependency badges are published
    Then publication fails with "<reason>" and branch context

    Examples:
      | operation | reason                                     |
      | reading   | HTTP 403: resource not accessible           |
      | publishing | HTTP 422: commit rejected                 |
      | racing    | expectedHeadOid does not match branch head  |

  Scenario: Unsafe badge paths and invalid publication targets cannot reach GitHub
    Then badge publication rejects unsafe paths and invalid targets without remote requests
