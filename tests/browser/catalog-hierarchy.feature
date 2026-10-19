# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Nested operation catalog
  Scenario: Nested paths close siblings and clear descendants
    Then catalog groups count their operations and keep one open descendant path

  Scenario Outline: Nested operation rows add nodes with useful focus
    When I use a viewport of <width> by 844 pixels
    Then nested catalog entries add operations to the workflow with useful focus

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario: Restoring a workflow loads canonical models in schema batches
    Then a multi-schema workflow restores through bounded model requests
