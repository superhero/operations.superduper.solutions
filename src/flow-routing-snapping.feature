# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Reference connection snapping regressions in workflow coordinates

  Scenario: chooses the nearest compatible input and uses measured absolute handle centers
    Given a text output over a Switch panel with two compatible gate inputs
    When the nearest compatible input is selected using absolute measured geometry
    Then chooses the nearest compatible input and uses measured absolute handle centers

  Scenario: filters occupied Switch gates before choosing the nearest acceptable input
    Given a Switch panel with its nearest gate already occupied
    When text object and structural outputs attempt to snap to the panel
    Then filters occupied Switch gates before choosing the nearest acceptable input

  Scenario: only snaps inside a visible, measured, connectable node other than the source
    Given out-of-bounds pointers and unavailable measured target panels
    When body snapping checks target eligibility
    Then only snaps inside a visible, measured, connectable node other than the source

  Scenario: overlaps prefer the highest eligible node, with later nodes winning equal z-index
    Given overlapping eligible Switch panels with different stacking orders
    When body snapping ranks valid panels in both iteration orders
    Then overlaps prefer the highest eligible node, with later nodes winning equal z-index

  Scenario: preserves native valid snaps and ignores reverse drags and source-only nodes
    Given native snaps reverse drags inactive origins and source-only panels
    When body snapping checks whether a candidate is needed
    Then preserves native valid snaps and ignores reverse drags and source-only nodes

  Scenario: keeps input state unchanged, including origin-adjusted geometry and final drag state
    Given a connection with origin-adjusted measured coordinates
    When body snapping evaluates preview and final drag states
    Then keeps input state unchanged, including origin-adjusted geometry and final drag state
