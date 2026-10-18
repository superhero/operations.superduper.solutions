# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@toolbar-controls
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
  Scenario: Workflow clipboard shortcuts and toolbar buttons
    Given nested workflow input and output branches mapped to another operation
    Then workflow clipboard shortcuts and buttons preserve graphs across new workflows
  Scenario: Open workflow uses the configured shortcut
    Given nested workflow input and output branches mapped to another operation
    Then the configurable open workflow shortcut opens the saved workflow picker
  Scenario: Run workflow opens from its shortcut
    Given nested workflow input and output branches mapped to another operation
    Then the run workflow shortcut opens the run view
  Scenario: Workflow history opens from its shortcut
    Given nested workflow input and output branches mapped to another operation
    Then the history shortcut opens workflow history
  Scenario Outline: Escape closes the active side menu
    Given nested workflow input and output branches mapped to another operation
    Then Escape closes either menu while respecting nested controls at width <width>
    Examples:
      | width |
      | 1280  |
      | 640   |
