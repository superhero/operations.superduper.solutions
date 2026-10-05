# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Dependency badge commits do not invalidate tested code

  Scenario Outline: Only complete dependency badge advances are exempt from revision checks
    Given a badge advance contains "<change>"
    When the badge-only advance is checked
    Then the badge-only advance is "<outcome>"

    Examples:
      | change                          | outcome  |
      | paginated badge commits         | accepted |
      | a code change                   | rejected |
      | a coverage badge change         | rejected |
      | a code file renamed into a badge | rejected |
      | a merge commit                  | rejected |
      | unrelated history               | rejected |
      | incomplete commit history       | rejected |
      | the file limit                  | rejected |
      | an API failure                  | rejected |
