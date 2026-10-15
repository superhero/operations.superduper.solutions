# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-browser @vault-browser-origin @chromium-only
Feature: Restoring a vault on another relying-party domain
  Browser storage belongs to an origin and a passkey belongs to its RP domain.
  Independent password and recovery methods remain explicit restore choices.

  Scenario Outline: A different RP domain requires an independent backup unlock method
    Given I create a synthetic vault on the localhost relying-party origin
    Then its native passkey cannot restore on another RP domain before I explicitly choose "<method>"

    Examples:
      | method   |
      | password |
      | recovery |
