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

  Scenario Outline: A dragged node centers on the grid and moves freely when snapping is disabled
    Then dragging a workflow "<kind>" snaps its center to the <gridSize>px grid and preserves its saved coordinates

    Examples:
      | kind      | gridSize |
      | operation | 12       |
      | data      | 12       |
      | operation | 18       |
      | data      | 18       |

  Scenario Outline: Newly added nodes center on the configured grid independently of dragging snap
    Then adding workflow nodes aligns their centers with snapping "<snap>" without moving existing nodes

    Examples:
      | snap |
      | off  |
      | on   |
