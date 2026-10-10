# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Run workflows through the example HTTP endpoint
  Scenario: Open a saved workflow and choose its starting operation
    Then a saved workflow opens a request run with starting choices and an end control

  Scenario: Validate inputs and continue with connected task results
    Then the workflow run dialog validates inputs and passes task results to the next operation

  Scenario: Route through a Switch and Cast before the next operation
    Then the workflow run dialog follows a matching switch gate through a cast

  Scenario: Cancel a run while preserving the editable workflow
    Then ending a workflow run restores the canvas and leaves its saved graph unchanged
