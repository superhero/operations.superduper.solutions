# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls @touch-pane
Feature: Touch controls follow available space rather than a phone classification

  @chromium-only
  Scenario: A tablet resizes docked panes with real touch input
    Then a touch tablet resizes both docked panes and keeps side panes when space allows

  @chromium-only
  Scenario: Compact panes follow deliberate dismissal swipes
    Then compact pane grips follow touch swipes and ignore short wrong-direction and cancelled gestures

  Scenario: Touch users have tap alternatives to dragging and swiping
    Then touch pane grips expose size controls and close panes without an X button

  @chromium-only
  Scenario: Pane content scrolls independently of the dismissal grip
    Then vertical content scrolling and viewport height changes do not dismiss touch panes
