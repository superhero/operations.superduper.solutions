# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-layout
Feature: New workflow nodes form orderly schema trees

  Scenario: Measured schema trees align columns and separate nested branches
    Then measured workflow schema trees keep wide owners clear, align columns, and separate unequal nested subtrees

  Scenario: New operations append after existing bounds on the previous owner row
    Then appended workflow nodes place all new inputs after existing bounds and preserve the previous owner row

  Scenario: Utility nodes append to the right with grid-aligned centers
    Then workflow utility nodes append to the right and snap their centers

  Scenario: Unmeasured nodes use dimensions or defaults without disturbing missing owners
    Then unmeasured workflow nodes use explicit dimensions or safe defaults while missing owners stay untouched

  Scenario: Invalid and inactive edges cannot distort new schema trees
    Then nonstructural, hidden, duplicate and cyclic workflow edges cannot distort the new schema tree
