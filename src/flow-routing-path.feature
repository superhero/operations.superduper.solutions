# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Stable path projection during workflow interaction

  Scenario: rounded paths, drag previews, and label midpoints use the same 8px corner
    Given a right-angle route with an eight-unit corner radius
    When its rendered path preview and midpoint are calculated
    Then rounded paths, drag previews, and label midpoints use the same 8px corner

  Scenario: a pending horizontal preview keeps its prefix while following the exact moving tip
    Given a horizontal terminal route and a nearby moving pointer
    When the pending horizontal preview follows the pointer
    Then a pending horizontal preview keeps its prefix while following the exact moving tip

  Scenario: vertical terminal previews project the last bend in the perpendicular direction
    Given a vertical terminal route and a nearby moving pointer
    When the pending vertical preview follows the pointer
    Then vertical terminal previews project the last bend in the perpendicular direction

  Scenario: exact previews retain their route and missing or stale source geometry is rejected
    Given a cached route with exact missing and stale source geometries
    When each source geometry is considered for a preview
    Then exact previews retain their route and missing or stale source geometry is rejected

  Scenario: projection rejects reversed approaches, turns, or changed port directions
    Given routes with reversed diagonal and changed-direction approaches
    When invalid terminal projections are compared with a valid perpendicular change
    Then projection rejects reversed approaches, turns, or changed port directions

  Scenario: a reversed-side snap moves the final approach while retaining the outer detour
    Given an outer detour and a snapped input on the reversed side
    When the final approach moves across the source while retaining the detour
    Then a reversed-side snap moves the final approach while retaining the outer detour

  Scenario: a short detour can move its approach without reversing the prefix or collapsing its terminal segment
    Given a short two-bend preview and a target near its final bend
    When the terminal approach moves toward the source
    Then a short detour can move its approach without reversing the prefix or collapsing its terminal segment

  Scenario: zero-length segments do not change direction checks and straight routes keep their source fixed
    Given routes with duplicate vertices and a straight source segment
    When the target moves while preview direction checks are applied
    Then zero-length segments do not change direction checks and straight routes keep their source fixed

  Scenario: crossing the bend axis keeps the detour before, at, and after a collapsed hairpin
    Given a hairpin detour next to its collapsing bend axis
    When the target crosses the axis in both orientations
    Then crossing the bend axis keeps the detour before, at, and after a collapsed hairpin

  Scenario: attached endpoint movement keeps the interior fixed and equal movement translates the whole route
    Given an attached detour with independently movable endpoints
    When source target equal and unequal endpoint movements are projected
    Then attached endpoint movement keeps the interior fixed and equal movement translates the whole route

  Scenario: initially straight arrows acquire local elbows for source or target movement in both orientations
    Given initially straight routes in both orientations
    When either endpoint moves away from its original line
    Then initially straight arrows acquire local elbows for source or target movement in both orientations

  Scenario: pointer and snap-ghost projections remain independent
    Given a shared cached route for a pointer and a landing ghost
    When the pointer moves while the landing ghost stays snapped
    Then pointer and snap-ghost projections remain independent

  Scenario: the scope cache retains its obstacle detour when acquiring, changing, and losing a snap target
    Given a scoped preview cache containing an obstacle detour
    When the drag acquires changes and loses its snap target
    Then the scope cache retains its obstacle detour when acquiring, changing, and losing a snap target

  Scenario: the scope cache rejects inactive geometry, other drag sessions, sources, or directions
    Given a scoped preview cache tied to one drag and source direction
    When inactive and unrelated geometries attempt to reuse that cache
    Then the scope cache rejects inactive geometry, other drag sessions, sources, or directions
