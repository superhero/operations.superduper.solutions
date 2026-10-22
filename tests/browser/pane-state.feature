# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Resume side panes across browser sessions
  Scenario: Refresh restores both desktop panes and their reading positions
    Then refreshing restores pane widths branches settings sections and scroll positions

  Scenario: Refresh retains navigation searches and separate browse expansion
    Then refreshing restores a search and its collapsed branches without losing the browse tree

  @touch-pane
  Scenario: Compact panes restore their contents and scroll positions after refresh
    Then compact Settings and Navigation resume after refresh without obscuring their content

  Scenario: Invalid pane snapshots leave a usable interface
    Then invalid saved pane state falls back to valid interface defaults
