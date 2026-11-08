# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-filesystem-watch-host @native-watch-real
Feature: Pinned native filesystem watch channel
  This opt-in evaluation needs the separately pinned task-owned Codex binary.

  Scenario: The pinned SDK delivers owned filesystem changes and stops after unwatch acknowledgement
    Then the real pinned native SDK preserves watch notifications and the unwatch barrier

  @native-watch-transport
  Scenario: The pinned SDK preserves watch events through authenticated HTTPS and WSS
    Then the pinned SDK watch lifecycle crosses authenticated HTTPS and WSS

  @native-watch-transport
  Scenario: The pinned SDK reports root loss before the authenticated watch channel ends
    Then the pinned SDK reports the terminal root before its authenticated watch channel closes

  @native-watch-private
  Scenario: The pinned SDK watch lifecycle retains encrypted private worker authority
    Then the encrypted private watch uses actual pinned SDK events and native unwatch acknowledgement

  @native-watch-workflow
  Scenario: The pinned SDK filesystem event routes through workflow ports and explicit unwatch
    Then the pinned SDK routes a filesystem event through native workflow ports and explicit unwatch
