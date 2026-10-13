# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-connection-types
Feature: Compatible workflow connection types
  Interactive connections preserve documented types and require Cast for conversions.

  Scenario: Documented field types only connect to compatible inputs
    Then workflow fields allow exact types and Integer to Number only

  Scenario: Cast accepts scalars and declares its output type
    Then Cast connections accept known scalars and use the selected output type

  Scenario: Switch outputs preserve the main input through chains
    Then Switch chains preserve Integer and the other scalar types

  Scenario: Unknown, mixed, and cyclic Switch sources are unavailable
    Then unresolved Switch outputs cannot supply new connections

  Scenario: Comparison operands follow the main input type
    Then Switch operands match the main type with numeric comparisons in either direction

  Scenario: Comparison operands may be wired before the main input
    Then an operand wired first constrains its subsequent Switch main input

  Scenario: Wiring a main input validates existing downstream connections
    Then incoming Switch values preserve compatibility throughout downstream Switch chains

  Scenario: Inactive edges and hidden nodes do not constrain connections
    Then inactive Switch connections do not affect inferred or downstream types

  Scenario: Unrelated legacy mismatches remain editable
    Then an unrelated legacy type mismatch does not block a compatible connection

  Scenario: Saved workflows retain mismatched connections
    Then saved workflows with old type mismatches still import without losing edges
