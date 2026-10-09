# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Direct workflow node manipulation
  Scenario Outline: Dragged nodes follow the pointer with normal animations enabled
    Then dragging a workflow "<kind>" keeps its rendered position and connections synchronized

    Examples:
      | kind      |
      | operation |
      | data      |
