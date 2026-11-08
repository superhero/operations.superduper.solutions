# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Literal beta query routes
  Scenario: Literal selectors preserve route identities and exact URLs
    Then beta variants retain their native paths while both executors send the selector exactly once

  Scenario: Literal selectors cannot change authority or be overridden
    Then beta route validation rejects unreviewed selectors unsafe paths and editable selector collisions

  Scenario: All native beta routes retain their source identity
    Then all 127 beta operations have qualified canonical routes and unchanged source identities

  Scenario: Beta native corrections preserve path metadata and require reviewed sources
    Then beta native corrections preserve path metadata and reject unrelated source identities

  Scenario: Beta skill uploads use the documented multipart names
    Then both native beta skill requests send files array parts and retain the beta selector

  Scenario: Work payloads are acquired privately
    Then all six beta work result routes persist credential payloads privately and survive vault reload

  Scenario: Beta Responses preserves JSON and bounded streaming behavior
    Then native beta Responses sends exact selectors for JSON and terminal SSE without exposing credentials
