# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Nested operation catalog
  @service-defaults
  Scenario Outline: Slash-separated schema names form browsable provider and product groups
    When I use a viewport of <width> by 844 pixels
    Then schema name groups preserve counts search and operation selection

    Examples:
      | width |
      | 390   |
      | 1280  |

  @service-defaults
  Scenario: Renaming and disabling schemas updates their navigation groups
    Then schema name groups follow saved schema names and enablement

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
