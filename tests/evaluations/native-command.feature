# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-command-transport @native-command-sdk
Feature: Pinned SDK command process qualification
  Only owned commands and loopback resources run within the bounded QA task.

  Scenario: Pinned command SDK preserves argv cwd environment exit codes and configured sandbox
    Then the pinned command SDK executes approved buffered commands with its configured boundaries

  Scenario: Pinned command SDK supports an input pipe before its final response
    Then the pinned command SDK preserves stdin bytes and ordered binary output

  Scenario: Pinned command SDK owns PTY resize termination and disconnect cleanup
    Then the pinned command SDK resizes and terminates its owned PTY and closes child processes

  Scenario: Pinned command dispatch cannot borrow an executable from caller PATH
    Then the pinned command dispatcher stays pinned across PATH overrides and approval changes
