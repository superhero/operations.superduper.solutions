# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing @flow-routing-handoff
Feature: Pending routing previews retain their displayed path when committed
  Scenario: A changed snap target inherits the displayed detour while a calculation is pending
    Given an obstacle detour cached before the pointer changes its snap target
    When the latest snapped preview is committed before a new route arrives
    Then the new edge receives the latest projected preview without changing its cached geometry

  Scenario: Acquiring a snap after a free-pointer calculation preserves the release path
    Given a cached free-pointer detour in the current drag session
    When the drag acquires a snap target and immediately commits
    Then the release inherits the displayed detour despite the cache having no target identity

  Scenario: Reverse native drags preserve the preview in committed output-to-input order
    Given a cached preview dragged from an input toward an output
    When the reverse drag commits its latest snapped endpoints
    Then the completed route reverses the displayed preview and preserves port directions

  Scenario: Other sessions origins targets and endpoint directions cannot borrow a release preview
    Given a valid cached preview and its latest snapped geometry
    When stale unrelated and incompatible connections request the cached release
    Then only the matching drag and exact committed endpoint identities are eligible

  Scenario: Invalid cached polylines cannot be handed off as committed routes
    Given invalid and unprojectable cached route geometries
    When their matching preview endpoints are committed
    Then the release declines each invalid projection without mutating the cache
