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

  Scenario: Command preparation retains the exact approved input and owner
    Then private command preparation cannot replace its argv directory cap environment or request owner

  Scenario: Verified dispatch prefixes preserve caller environment intent
    Then private command preparation preserves owned PATH prefixes and unrelated environment values

  Scenario: Dispatch and output retain their process identity and cap
    Then private command dispatch and output cannot acquire another process or exceed their approved cap

  Scenario: Private command owners retain stamped authority capacity and finite queues
    Then private command owners preserve stamped authority shared capacity and finite event queues

  Scenario: Command cancellation retains opening approval and anonymous dispatch barriers
    Then private command cancellation retains opening approval and dispatch barriers including anonymous processes

  Scenario: Private command controls retain authority and post-request cancellation
    Then private command controls retain signal identity authority and post-request cancellation

  Scenario: Command cancellation callback faults and buffered output remain private
    Then private command cancellation callback faults remain contained and buffered output stays private
