# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Fit workflows into the visible workspace
  Scenario Outline: Fit View accounts for open and resized side panes
    Then Fit View centers the graph between visible panes with "<motion>" motion

    Examples:
      | motion        |
      | reduce        |
      | no-preference |
