# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Synchronize released code
  Released code reaches develop, and released hotfixes also reach an active release.
  Develop receives released history even when it already contains the same code.
  Retries preserve branch history and reuse existing synchronization pull requests.

  Scenario Outline: Released code synchronization handles <state>
    Given release synchronization encounters "<state>"
    When the released code is synchronized
    Then synchronization is "<outcome>" with <writes> GitHub writes and reports "<message>"

    Examples:
      | state                                | outcome  | writes | message                                  |
      | a release needing develop            | accepted | 1      | Synchronization (main -> develop)        |
      | an existing develop synchronization   | accepted | 0      | Synchronization (main -> develop)        |
      | develop already containing squashed content | accepted | 1 | Synchronization (main -> develop)        |
      | develop differing only in dependency badges | accepted | 1 | Synchronization (main -> develop)        |
      | develop already containing main history | accepted | 0   | no synchronization PR needed             |
      | a hotfix without an active release    | accepted | 0      | No active release PR                     |
      | a deleted hotfix branch               | accepted | 2      | hotfix/0.0.25 -> release/0.0.26           |
      | the original hotfix head              | accepted | 2      | hotfix/0.0.25 -> release/0.0.26           |
      | badges after the original hotfix head | accepted | 2      | hotfix/0.0.25 -> release/0.0.26           |
      | an already reconciled hotfix          | accepted | 1      | hotfix/0.0.25 -> release/0.0.26           |
      | a merge conflict during reconciliation | rejected | 1    | gh: HTTP 409: Merge conflict              |
      | new code during reconciliation       | rejected | 1      | without unpublished code                  |
      | a branch advancing before reconciliation | rejected | 0  | before reconciliation                    |
      | an existing hotfix synchronization    | accepted | 0      | hotfix/0.0.25 -> release/0.0.26           |
      | a fast-forwarded hotfix head          | accepted | 1      | hotfix/0.0.25 -> release/0.0.26           |
      | a hotfix with only newer badges       | accepted | 1      | hotfix/0.0.25 -> release/0.0.26           |
      | a release already containing the fix  | accepted | 0      | already contains released merge          |
      | an already tagged release target     | accepted | 0      | its version is already tagged            |
      | unexpected hotfix changes             | rejected | 0      | changed unexpectedly                     |
      | ambiguous active releases             | rejected | 0      | Expected at most one active release PR   |
      | GitHub failing to list releases       | rejected | 0      | Could not discover open same-repository  |
      | GitHub refusing a branch restore      | rejected | 1      | Could not restore hotfix/0.0.25           |
