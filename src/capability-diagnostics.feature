# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@capability-diagnostics
Feature: Independent operation capabilities
  Scenario: Independent failures are reported together without changing the source
    Then endpoint parameter body authentication and response limitations remain independent

  Scenario: Fixing the first limitation does not make the other contracts executable
    Then resolving capability failures one by one retains the remaining guards

  Scenario: Authentication alternatives retain source identities and AND requirements
    Then capability alternatives keep unsupported positions anonymous choices and malformed declarations distinct

  Scenario: Connection requirements are separate from static schema failures
    Then supported authentication native and Docker operations describe their independent requirements

  Scenario: Discovery diagnostics are compact current and presentation only
    Then discovery capabilities match canonical diagnostics and reject obsolete or malformed indexes

  Scenario: Forged discovery and caller metadata cannot override canonical blockers
    Then current canonical capability failures stop graph HTTP and private approval dispatch
