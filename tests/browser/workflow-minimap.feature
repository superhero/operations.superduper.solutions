# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Workflow minimap navigation
  Scenario Outline: Minimap keyboard navigation preserves the graph
    Given a connected saved QA workflow
    Then the minimap pans zooms and fits with "<motion>" motion without editing operations

    Examples:
      | motion        |
      | no-preference |
      | reduce        |

  Scenario: Minimap pointer navigation works at desktop and mobile sizes
    Given a connected saved QA workflow
    Then the minimap supports pointer navigation and fits narrow and short viewports
