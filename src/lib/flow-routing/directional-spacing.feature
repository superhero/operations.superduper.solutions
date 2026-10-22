# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Opposing connections use separate lanes
  Scenario: Opposing runs separate while matching directions share their route
    Given coincident routes travelling in each of the four directions
    When new connections and complete scenes are routed beside opposing traffic
    Then opposite runs have six units of ordered separation and matching runs still overlap

  Scenario: Obstacle clearance takes priority over directional spacing
    Given a shared opposing run beside an obstacle blocking its preferred lane
    When directional separation cannot preserve node clearance
    Then the clear original run and existing route remain unchanged
