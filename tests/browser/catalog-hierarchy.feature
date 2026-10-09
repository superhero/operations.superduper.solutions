# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Nested operation catalog
  Scenario: Nested paths close siblings and clear descendants
    Then catalog groups count their operations and keep one open descendant path

  Scenario Outline: Nested operation descriptions and actions retain their destinations
    When I use a viewport of <width> by 844 pixels
    Then nested catalog entries open a form and add an operation to the workflow

    Examples:
      | width |
      | 390   |
      | 1280  |
