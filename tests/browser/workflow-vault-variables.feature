# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Connectable vault variables
  Scenario: Vault variable toolbar selection survives reload without exporting local references
    Given I create a vault in the Secrets settings and save a synthetic credential
    And a workflow with 1 instances of "Example object response"
    Then I can add and connect a vault variable without exposing its value
