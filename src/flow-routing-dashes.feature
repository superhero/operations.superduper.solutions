# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: World-aligned animated routing dashes

  Scenario: Non-default integer and fractional dash periods align in every direction
    Given shared straight sections using integer and fractional dash periods
    When their world phases advance in all four directions
    Then custom dash periods preserve shared alignment and bounded offsets

  Scenario: Non-default dash periods preserve shared circular bends and reverse phases
    Given shared rounded bends using integer and fractional dash periods
    When their forward and reverse dash segments are generated
    Then custom dash periods preserve shared arcs and use each incoming direction

  Scenario: same-direction shared runs align despite different prefixes and starting coordinates
    Given overlapping same-direction routes with different prefixes
    When dash phases are sampled along their shared horizontal section
    Then same-direction shared runs align despite different prefixes and starting coordinates

  Scenario: all four directions align with fractional and negative world coordinates
    Given fractional negative coordinates in all four directions
    When world-aligned dash phases are sampled along each direction
    Then all four directions align with fractional and negative world coordinates

  Scenario: opposite directions keep separate phases and move in opposite world directions
    Given two routes traversing the same section in opposite directions
    When their dash phases advance through the same animation interval
    Then opposite directions keep separate phases and move in opposite world directions

  Scenario: segment subdivision and newly added edges use the same phase without an edge clock
    Given a full route a subdivided route and a newly added overlapping route
    When their dash phases are sampled using the shared animation clock
    Then segment subdivision and newly added edges use the same phase without an edge clock

  Scenario: rounded shared bends retain identical dash geometry and phase after different prefixes
    Given rounded routes sharing two bends after different prefixes
    When their rounded dash geometry and phase are calculated
    Then rounded shared bends retain identical dash geometry and phase after different prefixes

  Scenario: geometry is not mutated, empty segments are skipped, and unsupported geometry stays unsplit
    Given duplicate route points custom periods and unsupported dash geometry
    When the dash segment generator validates and splits the geometry
    Then geometry is not mutated, empty segments are skipped, and unsupported geometry stays unsplit
