# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-browser @vault-browser-keyboard
Feature: Keyboard access to encrypted credential management
  Secret management remains reachable without pointer interaction, and cancelling
  unfinished edits clears the actual DOM values without changing the saved vault.

  Scenario: Keyboard users create replace cancel lock and bind a credential
    Given I open Secrets settings using only the keyboard
    When I create and replace a vault credential using only the keyboard
    Then keyboard cancellation clears credential and recovery inputs without saving them
    And keyboard credential selection approves only the displayed destination and sends the replacement value
