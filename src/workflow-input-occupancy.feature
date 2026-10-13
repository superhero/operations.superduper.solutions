# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-input-occupancy
Feature: Connected workflow inputs
  Each input accepts one connection while outputs can supply several different inputs.

  Scenario Outline: A connected input rejects another source until its connection is removed
    Then the <input> input rejects another connection and unlocks after removal

    Examples:
      | input          |
      | field          |
      | cast           |
      | switch value   |
      | switch operand |
      | legacy         |

  Scenario: Output fanout and separate input fields remain available
    Then a connected output can supply other input fields and nodes

  Scenario: Structural and inactive edges do not occupy an input
    Then schema, hidden, and detached edges leave value inputs available

  Scenario: Legacy inputs have one identity without a handle
    Then null and omitted input handles share the same occupancy

  Scenario: Previously saved workflows retain their connections
    Then saved workflows with multiple sources for an input still import without losing edges
