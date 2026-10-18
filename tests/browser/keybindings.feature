# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Workflow keybinding preferences
  Scenario: Custom shortcuts persist and leave text editing alone
    Given nested workflow input and output branches mapped to another operation
    Then workflow shortcut preferences persist, prevent conflicts and preserve text editing
  Scenario: Selection gestures use the configured modifiers
    Given nested workflow input and output branches mapped to another operation
    Then configured node and rectangle modifiers retain the selection group
  Scenario: Delete selection supports nodes and connections
    Given nested workflow input and output branches mapped to another operation
    Then deletion shortcuts remove selected nodes and connections and respect editing fields
