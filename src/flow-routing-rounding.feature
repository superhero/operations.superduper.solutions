# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Safe circular corners for orthogonal routes

  Scenario: an 8-unit bend is a true quarter circle shared by line, arc, and label geometry
    Given an orthogonal corner with sufficiently long adjoining legs
    When the default circular corner segments are generated
    Then an 8-unit bend is a true quarter circle shared by line, arc, and label geometry

  Scenario: reverse travel uses the opposite circular sweep in every orientation
    Given a right-angle route rotated through every orientation
    When forward and reverse circular segments are compared
    Then reverse travel uses the opposite circular sweep in every orientation

  Scenario: short adjacent legs clamp both radii without overlapping or emitting empty pieces
    Given two corners joined by a very short interior leg
    When both corner radii are clamped to the available leg length
    Then short adjacent legs clamp both radii without overlapping or emitting empty pieces

  Scenario: duplicate and forward-collinear vertices do not create corners, while radius zero retains subdivision
    Given a corner containing duplicate and collinear intermediate vertices
    When rounded and zero-radius segments are generated
    Then duplicate and forward-collinear vertices do not create corners, while radius zero retains subdivision

  Scenario: identical shared arcs retain their phase despite different route prefixes
    Given two routes entering the same bend after different prefixes
    When forward and reverse bend phases are calculated
    Then identical shared arcs retain their phase despite different route prefixes

  Scenario: a node inside a corner rectangle keeps that bend sharp; touching its boundary is allowed
    Given obstacles inside and touching the corner rectangle
    When rounding is evaluated with each obstacle placement
    Then a node inside a corner rectangle keeps that bend sharp; touching its boundary is allowed

  Scenario: input geometry remains unchanged and unsupported geometry is rejected
    Given valid route data alongside invalid points and radii
    When the corner generator validates its inputs without mutation
    Then input geometry remains unchanged and unsupported geometry is rejected
