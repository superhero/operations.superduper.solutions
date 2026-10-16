# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-defaults
Feature: Browser-local workflow defaults
  Scenario: Workflow defaults persist and initialize untouched and new workflows
    Then Settings sections open exclusively with the current workflow defaults in a fresh browser
    When I save different workflow defaults
    And workflow defaults recover after a failed settings save
    Then the defaults survive reload and initialize untouched and new workflows

  Scenario: Workflow defaults preserve current saved and imported workflow options
    Then workflow options remain independent from the saved defaults

  Scenario: Missing and malformed workflow defaults fall back independently for each option and grid size
    Then invalid workflow defaults retain valid booleans and safely reset other fields

  Scenario: Grid size slider preserves bounds and changes values faster near the center
    Then the grid size slider supports exact keys and saves its nonlinear pointer value across reload

  Scenario Outline: Saved node clearance is normalized independently from other workflow defaults
    Given workflow defaults saved with node clearance <stored>
    When Settings reloads the saved node clearance
    Then node clearance is <expected> and the other saved workflow defaults are preserved

    Examples:
      | stored   | expected |
      | missing  | 16       |
      | 0        | 0        |
      | 24       | 24       |
      | 128      | 128      |
      | -1       | 16       |
      | 129      | 16       |
      | 12.5     | 16       |
      | "24"     | 16       |
      | null     | 16       |
      | NaN      | 16       |
      | Infinity | 16       |

  Scenario: Node clearance accepts bounded integer values and rejects invalid drafts
    Then node clearance enforces its bounds and survives reload without saving a workflow

  @workflow-dash-settings
  Scenario: Dash length and speed normalize independently from other browser defaults
    Then missing and malformed dash settings preserve each other and the remaining workflow defaults

  @workflow-dash-settings
  Scenario: Dash length and speed accept bounded integers and retain a paused speed after reload
    Then dash length and speed controls reject invalid drafts and persist their independent limits

  @workflow-node-symbols
  Scenario: Node symbols change immediately and persist without hiding workflow actions
    Then the Node symbols preference hides existing node headings and footers across reload and restores them independently of actions

  @application-tooltips
  Scenario: Tooltips can be disabled without disabling their controls and the preference survives reload
    Then the Tooltips preference applies immediately and persists while controls remain usable
