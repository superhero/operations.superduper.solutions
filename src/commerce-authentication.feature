# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified Commerce access token authentication
  Scenario: Commerce authentication retains every native operation and source declaration
    Then all 40 Commerce operations require their documented access token through both parsers

  Scenario: Commerce authentication rejects source drift and anonymous substitutes
    Then Commerce corrections reject changed requirements identities and destinations before mutation

  Scenario: Commerce access tokens stay inside private dispatch
    Then a saved Commerce token authenticates its exact private request without exposing its value

  Scenario: Commerce requests cannot bypass their credential approval
    Then missing changed and reflected Commerce credentials cannot bypass approval or expose token values
