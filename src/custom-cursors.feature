# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Theme-aware cursor artwork
  Scenario: Embedded cursors retain geometry and hotspots in both modes
    Then cursor artwork renders with theme colors native fallbacks and intact masks

  Scenario: Invalid or contextual colors cannot enter cursor SVGs
    Then cursor rendering validates colors modes and artwork identifiers

  Scenario: Cursor variables update only when needed
    Then cursor theme application caches palettes and restores only its own native fallbacks

  Scenario: Invalid themes preserve the last valid state until native fallback is applied
    Then cursor theme failures are atomic and reported without breaking the page

  Scenario: Legacy appearance caches enable cursors without accepting invalid preferences
    Then the appearance cache validates custom cursor hints and handles unavailable storage
