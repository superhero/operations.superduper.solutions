# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-routing
@toolbar-controls
Feature: Curved assertion loop routing
  Scenario Outline: Curved assertion returns avoid nodes and support anchor adjustments
    Given a curved Filter array assertion loop at width <width>
    Then its curved returns avoid node bodies and support reversible anchor adjustments
    And a curved return uses the same safe snapped preview when connected
    And the Settings curve switch changes the open workflow immediately

    Examples:
      | width |
      | 390   |
      | 1280  |
