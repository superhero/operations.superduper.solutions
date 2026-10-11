# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Browser-local workflow defaults
  Scenario: Workflow defaults persist and initialize untouched and new workflows
    Then Settings sections open exclusively and workflow defaults start disabled
    When I enable all workflow defaults
    And workflow defaults recover after a failed settings save
    Then the defaults survive reload and initialize untouched and new workflows

  Scenario: Workflow defaults preserve current saved and imported workflow options
    Then workflow options remain independent from the saved defaults

  Scenario: Missing and malformed workflow defaults fall back independently for each option and grid size
    Then invalid workflow defaults retain valid booleans and safely reset other fields

  Scenario: Grid size slider preserves bounds and changes values faster near the center
    Then the grid size slider supports exact keys and saves its nonlinear pointer value across reload
