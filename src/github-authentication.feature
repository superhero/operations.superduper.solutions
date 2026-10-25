# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@github-authentication
Feature: GitHub operation authentication
  Scenario: Pinned GitHub authentication retains every operation and its published source
    Then GitHub authentication covers the native inventory and separates public access from permission-free access

  Scenario: GitHub user app and installation requests use their selected private profiles
    Then GitHub token roles dispatch privately without anonymous or cross-profile fallback

  Scenario: Documented GitHub public resources still execute anonymously
    Then GitHub public choices dispatch without credentials and cannot unlock private routes

  Scenario: GitHub OAuth app Basic credentials and token inputs stay private
    Then GitHub OAuth app references dispatch Basic privately while credential results remain blocked

  @coverage-gaps
  Scenario: GitHub corrections retain provenance and reject changed contracts
    Then GitHub corrections are isolated idempotent and bounded to their reviewed routes and origins
