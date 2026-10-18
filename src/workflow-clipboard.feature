# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Workflow selection clipboard
  Scenario: Copies contain independent schema trees
    Then copying schema nodes includes their owners and preserves only internal connections
  Scenario: Repeated pastes preserve graph invariants
    Then pasted graphs have fresh identities and translated routes without mutating the clipboard
  Scenario: Nested workflows preserve snapshot endpoints
    Then pasted nested workflows retain their original snapshot interfaces
