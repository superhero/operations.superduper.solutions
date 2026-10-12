# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Documentation integration accepts only Markdown documents
  A complete local Git comparison cannot hide code behind renames, special
  file modes, unusual paths, or an API file limit.

  Scenario Outline: Inspect the complete documentation diff for <change>
    Given a documentation branch contains "<change>"
    When its documentation changes are validated
    Then documentation validation is "<outcome>" with "<reason>" and preserves the checkout

    Examples:
      | change                              | outcome  | reason                       |
      | a Markdown addition                 | accepted |                              |
      | a Markdown edit                     | accepted |                              |
      | a Markdown deletion                 | accepted |                              |
      | a Markdown rename                   | accepted |                              |
      | unusual Markdown filenames          | accepted |                              |
      | more than 300 Markdown files         | accepted |                              |
      | documentation behind an updated base | accepted |                              |
      | code beside documentation           | rejected | Only Markdown                |
      | code after 300 Markdown files        | rejected | Only Markdown                |
      | code renamed to Markdown            | rejected | Only Markdown                |
      | Markdown renamed to code            | rejected | Only Markdown                |
      | executable Markdown                 | rejected | non-executable               |
      | formerly executable Markdown        | rejected | non-executable               |
      | deleted executable Markdown         | rejected | non-executable               |
      | a Markdown symlink                  | rejected | non-executable               |
      | a replaced Markdown symlink         | rejected | non-executable               |
      | a Markdown gitlink                  | rejected | non-executable               |
      | an empty commit                     | rejected | diff is empty                |

  Scenario Outline: Refuse unverifiable documentation history with <problem>
    Given a documentation branch contains "a Markdown edit"
    And its documentation comparison has "<problem>"
    When its documentation changes are validated
    Then documentation validation is "rejected" with "<reason>" and preserves the checkout

    Examples:
      | problem                  | reason                       |
      | a short SHA              | full commit SHAs             |
      | an extra argument        | full commit SHAs             |
      | an unavailable base      | Could not read revision      |
      | an unavailable head      | Could not read revision      |
      | a blob instead of a commit | is not a commit            |
      | unrelated histories      | common ancestor              |
      | ambiguous merge bases    | exactly one merge base       |
      | an unavailable tree      | complete documentation diff  |
