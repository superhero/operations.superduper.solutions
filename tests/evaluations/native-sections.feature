# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-sections-sdk
Feature: Pinned native thread section store
  This opt-in qualification uses a separately pinned SDK and empty owned homes.

  Scenario: The pinned SDK preserves section persistence appearance and store ownership
    Then the pinned SDK persists section metadata across children and rejects foreign section IDs

  @native-sections
  Scenario: The pinned SDK section lifecycle uses encrypted pairing and authenticated HTTPS WSS
    Then the pinned SDK section store crosses encrypted pairing and exact native method scopes
