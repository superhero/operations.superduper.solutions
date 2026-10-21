# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-curve
Feature: Workflow connection curve geometry

  Scenario: Routed curves avoid nodes around assertion returns
    Then curved routing keeps assertion return paths outside nodes at every strength

  Scenario: Routed curves restore diagonal spans and preserve editable anchors
    Then routed curves restore diagonal Beziers and retain authored steering points

  Scenario: Curves follow every port orientation with centered labels
    Then workflow curves follow every port orientation and keep their label at the cubic midpoint

  Scenario: Curve strength controls backward connection bends
    Then backward workflow connections bow out farther with increased curve strength

  Scenario: Curve projection and extrema stay stable between sampled steering points
    Then curved drawings project off-stroke controls and retain bounded quadratic extrema

  Scenario: Vertical terminal ports retain node-body clearance
    Then curved drawings open only the facing buffers of top and bottom ports

  Scenario: Large obstacle sets retain the checked backbone within the drawing budget
    Then curved drawings fall back to their checked route when obstacle certification is exhausted

  Scenario: Coincident handles remain drawable with an exhausted budget
    Then coincident curved connections retain finite paths labels and controls
