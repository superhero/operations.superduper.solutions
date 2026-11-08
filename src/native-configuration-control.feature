# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-control
Feature: Paired process-local configuration controls
  Scenario: Control models preserve native results and precise input diagnostics
    Then configuration control models roundtrip with native declarations and bounded named inputs
  Scenario: Feature and skill changes affect the same unauthenticated SDK child
    Then configuration controls change runtime features and skill roots without writing configuration
  Scenario: Controls require their own grant and canonical workspace roots
    Then configuration controls reject missing grants invalid roots and unrelated agent authority
  Scenario: Malformed acknowledgements and credential echoes cannot succeed
    Then configuration controls withhold mismatched results and known encoded secrets
  Scenario: Cancellation and changed authority revoke a dispatched control without replay
    Then configuration controls revoke pending requests and reject overlapping SDK work
  Scenario: MCP reload retains the owned loaded thread and configured tools
    Then configuration reload completes on the owned loaded thread without provider inference
