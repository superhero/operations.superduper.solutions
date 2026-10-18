# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Configurable workflow keybindings
  Scenario: Defaults and persisted settings remain usable
    Then keybindings normalize malformed settings and reject duplicate shortcuts
  Scenario: Portable shortcut matching preserves editing safety
    Then shortcuts match Control and Command exactly and ignore composition
  Scenario: Selection modifiers and redo alternatives remain configurable
    Then selection modifiers map to flow keys and explicit shortcuts override redo aliases
