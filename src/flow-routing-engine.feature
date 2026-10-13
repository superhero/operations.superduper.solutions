# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Obstacle-aware orthogonal routing

  Scenario: routes around blockers and retains the shortest direct route where clear
    Given a clear horizontal connection and a rectangular blocker
    When the connection is routed before and after adding the blocker
    Then routes around blockers and retains the shortest direct route where clear

  Scenario: backward and vertical routes honor ports and avoid their own node bodies
    Given backward and vertical connections with measured endpoint nodes
    When the routes are calculated for every port orientation
    Then backward and vertical routes honor ports and avoid their own node bodies

  Scenario: fractional coordinates and moved nodes produce valid updated routes without mutation
    Given fractional endpoint coordinates and a movable blocker
    When the blocker moves out of the route
    Then fractional coordinates and moved nodes produce valid updated routes without mutation

  Scenario: cramped adjacent nodes relax padding without crossing node bodies
    Given two adjacent nodes separated by a narrow gap
    When the connection is routed through the narrow gap
    Then cramped adjacent nodes relax padding without crossing node bodies

  Scenario: connection previews avoid a nearby crossing within the allowed detour
    Given a horizontal preview crossing a short existing vertical arrow
    When the preview is routed with the default crossing budget
    Then connection previews avoid a nearby crossing within the allowed detour

  Scenario: retains a crossing when avoiding it would exceed 300 percent additional length
    Given a horizontal preview crossing a very long existing vertical arrow
    When the crossing detour would exceed the default budget
    Then retains a crossing when avoiding it would exceed 300 percent additional length

  Scenario: accepts a crossing detour exactly at 4 times the baseline, but rejects one beyond it
    Given crossings at and immediately beyond the maximum allowed detour
    When the crossing lengths are compared with the four-times baseline
    Then accepts a crossing detour exactly at 4 times the baseline, but rejects one beyond it

  Scenario: node avoidance takes priority even when the necessary detour exceeds the crossing budget
    Given a blocker whose height requires a very long detour
    When node avoidance is evaluated with the crossing budget
    Then node avoidance takes priority even when the necessary detour exceeds the crossing budget

  Scenario: crossing improvements retain node clearance, including with a strict length budget
    Given a blocked connection with another crossing beyond its obstacle
    When crossing avoidance is evaluated with default and strict budgets
    Then crossing improvements retain node clearance, including with a strict length budget

  Scenario: shared port stems do not force a detour
    Given an existing route leaving the same source port as a new connection
    When the new connection is routed along the shared stem
    Then shared port stems do not force a detour

  Scenario: joins an existing bend directly instead of adding a dogleg before the shared input
    Given two outputs approaching one input from different heights
    When the upper connection approaches the existing lower bend
    Then joins an existing bend directly instead of adding a dogleg before the shared input

  Scenario: subdividing a straight route cannot hide a real crossing
    Given the same crossing with and without a collinear subdivision
    When the preview routes are compared across the subdivision
    Then subdividing a straight route cannot hide a real crossing

  Scenario: equally short clear paths prefer fewer bends without seeking an earlier overlap
    Given clear paths with different possible bend counts
    When the shortest orthogonal routes are selected
    Then equally short clear paths prefer fewer bends without seeking an earlier overlap

  Scenario: aligns parallel runs for more overlap without adding bends or length
    Given parallel route sections with matching endpoints and rotated equivalents
    When new connections are aligned with the existing sections
    Then aligns parallel runs for more overlap without adding bends or length

  Scenario: duplicate overlapping arrows do not change the preferred alignment
    Given competing overlap choices and duplicate shorter arrows
    When the overlap alignment is computed with and without duplicates
    Then duplicate overlapping arrows do not change the preferred alignment

  Scenario: overlap preference never adds bends to a straight arrow or moves a route into a node
    Given overlap opportunities that would add bends or intersect a node
    When the overlap preference is applied to the constrained routes
    Then overlap preference never adds bends to a straight arrow or moves a route into a node

  Scenario: complete graphs route deterministically regardless of node or edge array order
    Given a complete scene with crossing edges and node obstacles
    When the scene is routed in both node and edge iteration orders
    Then complete graphs route deterministically regardless of node or edge array order

  Scenario: impossible overlaps and explicitly bounded searches produce finite visible fallbacks
    Given impossible obstacles and deliberately bounded search limits
    When routes are calculated when detailed search cannot succeed
    Then impossible overlaps and explicitly bounded searches produce finite visible fallbacks

  Scenario: large graph limits bound detailed routing while preserving every connection
    Given one thousand nodes and four thousand connections
    When the graph is routed with only two detailed routes allowed
    Then large graph limits bound detailed routing while preserving every connection
