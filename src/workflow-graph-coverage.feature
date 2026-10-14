# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-graph-coverage
Feature: Additional workflow property editing preserves graph integrity

  Scenario: Only canonical direct user properties can be edited
    Then only canonical direct workflow user properties are offered for editing

  Scenario: Removing the final custom property restores the empty-object notice
    Then removing the last custom workflow field restores the empty-object notice

  Scenario: Input type changes retain incoming and unrelated mappings
    Then workflow input property type changes retain incoming wires and unrelated mappings

  Scenario: Property renaming retains ordering edges and updates required names
    Then workflow property renaming preserves order-only edges and recalculates required names

  Scenario: Malformed descendant identities reject branch renaming atomically
    Then renaming a workflow branch rejects malformed descendant identities without changing its source graph

  Scenario: Branch renaming respects schema identity limits
    Then workflow branch renaming enforces descendant path and encoded identity limits
