# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Application logging
  Application diagnostics preserve native errors for the development overlay.

  Scenario: Logged errors retain their source and diagnostic context
    Then application error logs put original errors first with their stacks causes and context

  Scenario: Other diagnostics keep their severity
    Then application informational warning and plain error logs keep their console severity

  Scenario: Scoped and unscoped loggers preserve diagnostics
    Then application logger scopes and optional metadata remain readable
