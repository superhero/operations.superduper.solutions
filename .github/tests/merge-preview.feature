# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Preview integration by content
  Histories are compared by their merged content before a release is created,
  without changing the checkout.

  Scenario Outline: Recognize meaningful changes despite different commit ancestry
    Given an integration with "<changes>"
    When the integration is previewed
    Then the preview reports substantive changes as "<changed>" without changing the checkout

    Examples:
      | changes                             | changed |
      | previously squashed code            | false   |
      | only dependency badges              | false   |
      | new application code                | true    |
      | a quality assurance badge           | true    |
      | application code renamed to a badge | true    |

  Scenario Outline: Report an integration that cannot be prepared
    Given an integration with "<changes>"
    When the integration is previewed
    Then the preview fails with "<reason>" and both commit SHAs

    Examples:
      | changes                 | reason                       |
      | conflicting code        | CONFLICT                     |
      | an unavailable commit   | fetch complete history       |

  Scenario Outline: Confirm that the released tree matches the tested artifacts
    Given a confirmed release with "<integration>"
    When its tree is compared with the tested head
    Then release tree validation is "<outcome>" with "<reason>" and preserves the checkout

    Examples:
      | integration                    | outcome  | reason                         |
      | a fast-forward                 | accepted |                                |
      | an ordinary merge              | accepted |                                |
      | a squash with identical trees  | accepted |                                |
      | only dependency badges         | accepted |                                |
      | unpublished application code   | rejected | application.ts                 |
      | code renamed into a badge      | rejected | application.ts                 |
      | a quality assurance badge      | rejected | .github/badges/test-scenarios.svg |
      | an application mode change     | rejected | application.ts                 |
      | an application symlink         | rejected | application.ts                 |
      | an unavailable released commit | rejected | fetch complete history         |
