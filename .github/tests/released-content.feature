# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Released synchronization content
  Reconciled squash history may synchronize released code and newer dependency badges.
  Unpublished code and unverifiable comparisons cannot enter a synchronization PR.

  Scenario Outline: Verify <change> against the released content
    Given released synchronization content includes "<change>"
    When the released synchronization content is checked
    Then the released synchronization content is "<outcome>"

    Examples:
      | change                        | outcome  |
      | a reconciled squash merge     | accepted |
      | a tagged release              | accepted |
      | new dependency badges         | accepted |
      | unpublished code              | rejected |
      | a code file renamed to a badge | rejected |
      | unrelated history             | rejected |
      | an incomplete file comparison | rejected |
      | a failed comparison           | rejected |
