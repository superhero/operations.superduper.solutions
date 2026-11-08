# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-command-transport
Feature: Independently approved native command transport
  Process controls share their original connection. Transport qualification
  alone does not grant catalog or workflow execution.

  Scenario: Commands require an independent opt in and exact transport role
    Then command transport cannot borrow agent read write or MCP grants

  Scenario: Commands wait for explicit single use approval before SDK dispatch
    Then command approval gates exact prepared arguments and refuses unrelated replies

  Scenario: Command controls retain ownership capability and terminal ordering
    Then only the owned running process accepts stdin terminal resize and termination

  Scenario: Command inputs preserve native argv and reject unsafe or malformed overrides
    Then command transport validates argv environment dimensions bytes and option bounds

  Scenario: Command cwd authority is canonical and rechecked after approval
    Then command transport rejects foreign symlinked and replaced working directories

  Scenario: Command output preserves bounded binary frames and terminal results
    Then command output enforces caps correlation and decoded credential checks

  Scenario: Command cancellation drift and disconnect revoke pending process authority
    Then command cancellation and authority changes close owned sessions without replay

  Scenario: Standalone command roles do not inherit thread shell execution
    Then a standalone command role cannot issue thread shell requests
