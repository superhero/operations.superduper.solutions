# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@vault-browser @vault-browser-keyboard
Feature: Keyboard access to encrypted credential management
  Secret management remains reachable without pointer interaction, and cancelling
  unfinished edits clears the actual DOM values without changing the saved vault.

  Scenario: Keyboard users create copy remove cancel lock and bind a credential
    Given I open Secrets settings using only the keyboard
    When I create copy remove and save vault credentials using only the keyboard
    Then keyboard cancellation and locking clear unsaved secrets without saving them
    And keyboard credential selection sends only the selected saved value without approval
