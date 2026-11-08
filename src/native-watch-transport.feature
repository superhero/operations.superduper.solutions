# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-watch-transport
Feature: Authenticated native filesystem watch transport
  An independently granted paired connection owns SDK watches and their notification lifetime.

  Scenario: Watch tickets require a separate grant and cannot acquire agent or write methods
    Then native watch transport permissions are independent and reject unrelated RPCs

  Scenario: HTTPS and WSS preserve owned watch events and the acknowledged unwatch barrier
    Then the authenticated watch transport forwards only owned notifications before unwatch

  Scenario: Changed authority during watch event review withholds publication
    Then account and workspace drift during native watch review close the owned channel

  Scenario: Acknowledged watch requests remain cancellable and tickets cannot be replayed
    Then native watch cancellation stops acknowledged subscriptions and rejects ticket reuse

  Scenario: Foreign origins and keys cannot start native watch children
    Then native watch transport denies foreign origins and invalid pairing credentials

  Scenario: Root removal delivers its final known path before ending the watch channel
    Then native watch transport delivers only the terminal known root after root removal
