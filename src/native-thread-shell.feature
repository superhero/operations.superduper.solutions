# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-thread-shell
Feature: Explicitly approved native thread shell
  The unsandboxed shell has its own grant, owned thread and real terminal events.

  Scenario: Shell models expose the two native terminal notifications and bounded inputs
    Then thread shell models retain typed command and completion events with field diagnostics
  Scenario: Thread shell requires an independent grant and an owned loaded thread
    Then thread shell rejects missing grants foreign threads stale selections and unloaded peers
  Scenario: Shell approval is single use and its ACK cannot complete a workflow
    Then private thread shell approval binds its request and waits for item and turn completion
  Scenario: Shell command text and terminal output cannot reveal saved credentials
    Then thread shell input and actual encoded terminal values withhold vault secrets
  Scenario: Shell cancellation and authority changes revoke exactly the owned attempt
    Then thread shell cancellation interrupts an accepted command and revokes pending approvals
  Scenario: Foreign reordered or incomplete shell events cannot succeed
    Then thread shell rejects foreign item identities duplicate events and terminal item omissions
