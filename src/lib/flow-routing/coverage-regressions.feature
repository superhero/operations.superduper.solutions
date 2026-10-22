# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Routing remains stable at geometry and work limits

  Scenario: Staggered facing terminals share overlapping clearance buffers
    Given a restored response above its operation at sixty-four-unit clearance
    When the same terminal corridor is routed in all four orientations
    Then only the facing buffers share the gap and the response takes the short editable route

  Scenario: Crossing detours disappear when later routes clear the shorter path
    Given four connections whose crossing avoidance clears an earlier direct corridor
    When the complete scene finishes crossing reduction
    Then the obsolete loop returns to its short clear route without moving authored anchors

  Scenario: A narrow terminal keeps the requested clearance around other node faces
    Given a narrow handle exit beside a node and a target behind it
    When clearance is varied and the same scene is reflected and rotated
    Then unconstrained source faces and every nonterminal target segment retain the requested clearance

  Scenario: Sharing a cramped route cannot remove clearance elsewhere
    Given a narrow terminal and an existing route hugging the target boundary
    When crossing reduction and shared-line alignment run at several clearances
    Then the new connection retains its target clearance while the existing route stays unchanged

  Scenario: Large clearances extend terminal stems and protect rounded bends
    Given measured endpoint bodies and a corner beside a clearance buffer
    When routing and rounding use clearances larger than the preferred stub
    Then terminal stems reach the buffer boundary and only safe corners are rounded

  Scenario: Overlapping terminal bodies recover when separated
    Given a source handle inside an overlapping node body
    When the obstructing body moves away to leave a narrow exit
    Then the impossible overlap falls back visibly and the separated bodies regain a checked route

  Scenario: Overlapping clearance buffers still prefer a checked body-avoiding fallback
    Given a narrow corridor enclosed by overlapping source and blocker buffers
    When clearance-preserving searches fail and the remaining work is bounded
    Then the last resort avoids node bodies without enabling clearance-losing optimization

  Scenario: Invalid numeric endpoints stay out of rendered routes
    Given endpoints containing non-finite diagram coordinates
    When invalid endpoint routes are requested through both entry points
    Then invalid endpoints return empty fallback geometry

  Scenario: Invalid routing options retain deterministic defaults
    Given invalid routing budgets and omitted port directions
    When default and defensive routing behavior are compared
    Then invalid options use defaults and absent directions retain visible fallback paths

  Scenario: Work exhaustion preserves every finite connection
    Given crossing and overlapping routes with small work budgets
    When every bounded budget is exercised across routing phases
    Then bounded routing preserves endpoints and does not mutate existing routes

  Scenario: Grid limits and distant routes retain bounded visible geometry
    Given crossing routes with distant segments and restricted search grids
    When crossing searches run with zero padding and small grids
    Then restricted searches retain finite complete routes

  Scenario: Midpoints follow sharp and anticlockwise rounded paths
    Given sharp multi-leg paths and an anticlockwise bend
    When their midpoint and degenerate geometry are evaluated
    Then midpoint geometry follows the drawn path and empty routes have no midpoint

  Scenario: Reflected joins and equal-distance overlaps remain deterministic
    Given mirrored shared-input bends and equally distant overlap choices
    When reflected connections and reordered overlap choices are routed
    Then joins keep their shortest length and tied overlap choices remain stable

  Scenario: Sharing a line never introduces an avoidable crossing
    Given a tempting shared run with a crossing on its approach
    When interior segment alignment considers the shared run
    Then the existing clear route is retained instead of adding a crossing

  Scenario: Collapsed projections request a checked replacement
    Given cached paths whose moving endpoints collapse their approaches
    When both endpoint projections and finite precision limits are evaluated
    Then invalid local projections are rejected without mutating cached points

  Scenario: A released preview is reused only at its exact endpoints
    Given a checked preview and completed edges with stable or moved endpoints
    When endpoint compatibility is checked before preview handoff
    Then only the exact completed edge accepts the preview geometry
