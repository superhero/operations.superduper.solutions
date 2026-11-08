# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-command-private
Feature: Private command ownership and approval
  A private broker owns the encrypted pairing, explicit approval, command stream
  and concurrent controls, with no authority to adopt foreign processes.

  Scenario: Private commands verify source selections profile ownership and independent grants
    Then private commands reject missing grants stale pairings and altered source selections

  Scenario: Private command progress distinguishes dispatch output and terminal completion
    Then private commands keep one owned child for approval streams and process controls

  Scenario: Private approval replies are single use and request owned
    Then private command approval cannot be replayed or borrowed by another request

  Scenario: Named command cancellation preserves a sibling process
    Then private command cancellation stops only its named process and does not replay effects

  Scenario: Private command bytes and progress cannot reveal known credentials
    Then private command input output and split encoded bytes withhold saved secrets

  Scenario: Private command state changes revoke output and execution authority
    Then private command source identity credential and lock changes revoke their owned attempts

  Scenario: Existing native roles cannot be replaced by command controls
    Then private command peers preserve active agent and watch ownership

  Scenario: Worker admission permits process controls alongside pending command streams
    Then command stream admission preserves ordinary serialization and bounded concurrency
