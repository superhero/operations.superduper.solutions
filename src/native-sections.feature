# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-sections
Feature: Owned native thread sections
  Independent read and write grants expose exact section methods without replay.

  Scenario: Section CRUD preserves persisted metadata pagination and appearance semantics
    Then encrypted section requests preserve SDK results and isolate every mutation

  Scenario: Section reads and writes require separate grants and exact method scopes
    Then native sections cannot borrow other grants or widen a read ticket

  Scenario: Section inputs validate names IDs nullable appearance and UTF-8 byte bounds
    Then native section inputs reject unreviewed fields and malformed presentation values

  Scenario: Section results withhold invalid structures and known credential echoes
    Then native section outputs preserve typed contracts and withhold private values

  Scenario: Cancelled and stale section mutations cannot publish success or replay
    Then native section mutations stop their owned request without replay or rollback claims

  Scenario: Section workflows retain concrete native ports and portable structured inputs
    Then native section workflow models preserve typed outputs and nullable appearance inputs
