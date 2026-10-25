# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@service-defaults @capability-ui
Feature: Inspect independent operation requirements
  Scenario Outline: Current limitations remain accessible without loading operation models
    When I use a viewport of <width> by 844 pixels
    Then operation limitations show independent causes and authentication choices without model loading
    Examples:
      | width |
      | 1280  |

  @touch-pane
  Scenario: A phone touch can open and dismiss the limitation details
    When I use a viewport of 390 by 844 pixels
    Then operation limitations show independent causes and authentication choices without model loading
