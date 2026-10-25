# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: GitHub Notifications authentication
  Scenario: Notifications retain native identity and require their documented classic PAT
    Then the ten GitHub Notifications contracts preserve their pinned source and distinct classic personal profile

  Scenario: Every Notifications method dispatches through its exact private contract
    Then all ten GitHub Notifications methods send exact private paths inputs and bounded results

  Scenario: Unsupported token roles and stale approval cannot dispatch
    Then GitHub Notifications reject anonymous wrong-role missing and stale credential bindings before fetch

  Scenario: Authentication failure never changes roles or unlocks residual contracts
    Then GitHub Notifications never fall back after denial and retain unreviewed and credential-result guards
