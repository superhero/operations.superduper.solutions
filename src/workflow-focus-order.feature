# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-focus-order
Feature: Workflow keyboard focus follows schema columns
  Scenario: Each operation visits outer inputs through outer outputs in schema field order
    Given workflow operations with nested input and output branches in shuffled edge order
    When workflow nodes are ordered for keyboard focus
    Then each operation follows schema depth and field order without moving or replacing nodes
    And hidden schema branches remain in the ordered document
    And dragging nodes does not change their keyboard focus order

  Scenario: Workflow references and utilities retain their place among operations
    Given workflow references and standalone utilities among operations
    When workflow nodes are ordered for keyboard focus
    Then references use their interface order and utilities retain their document order

  Scenario: Incomplete graphs and mapping cycles retain every node exactly once
    Given workflow nodes with cyclic mappings, invalid schema attachments, and orphan branches
    When workflow nodes are ordered for keyboard focus
    Then valid schema branches precede stable orphan fallbacks without duplicate nodes

  Scenario: Render updates preserve canonical document order
    Given a canonical workflow document order
    When rendered nodes arrive reordered with replacements, removals, and additions
    Then the updated document keeps its surviving order and appends new nodes
    And empty node collections remain supported
