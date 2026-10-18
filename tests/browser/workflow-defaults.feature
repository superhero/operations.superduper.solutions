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
    Then saved workflow defaults "invalid booleans" normalize after reload without changing valid fields
    And saved workflow defaults "invalid fields" normalize after reload without changing valid fields
    And saved workflow defaults "out-of-range grid size" normalize after reload without changing valid fields
    And saved workflow defaults "fractional grid size" normalize after reload without changing valid fields
    And saved workflow defaults "text grid size" normalize after reload without changing valid fields
    And saved workflow defaults "non-object defaults" normalize after reload without changing valid fields

  Scenario: Grid size slider preserves bounds and changes values faster near the center
    Then the grid size slider supports exact keys and saves its nonlinear pointer value across reload

  Scenario: Saved node clearance is normalized independently from other workflow defaults
    Then saved node clearance missing normalizes to 16 after reload without changing other defaults
    And saved node clearance 0 normalizes to 0 after reload without changing other defaults
    And saved node clearance 24 normalizes to 24 after reload without changing other defaults
    And saved node clearance 128 normalizes to 128 after reload without changing other defaults
    And saved node clearance -1 normalizes to 16 after reload without changing other defaults
    And saved node clearance 129 normalizes to 16 after reload without changing other defaults
    And saved node clearance 12.5 normalizes to 16 after reload without changing other defaults
    And saved node clearance "24" normalizes to 16 after reload without changing other defaults
    And saved node clearance null normalizes to 16 after reload without changing other defaults
    And saved node clearance NaN normalizes to 16 after reload without changing other defaults
    And saved node clearance Infinity normalizes to 16 after reload without changing other defaults

  Scenario: Node clearance accepts bounded integer values and rejects invalid drafts
    Then node clearance enforces its bounds and survives reload without saving a workflow

  @workflow-dash-settings
  Scenario: Dash length and speed normalize independently from other browser defaults
    Then saved dash length missing and speed missing normalize to 8 and 64 after reload without changing other defaults
    And saved dash length missing and speed 31 normalize to 8 and 31 after reload without changing other defaults
    And saved dash length 17 and speed missing normalize to 17 and 64 after reload without changing other defaults
    And saved dash length 1 and speed 0 normalize to 1 and 0 after reload without changing other defaults
    And saved dash length 128 and speed 512 normalize to 128 and 512 after reload without changing other defaults
    And saved dash length "18" and speed 31 normalize to 8 and 31 after reload without changing other defaults
    And saved dash length 17 and speed -1 normalize to 17 and 64 after reload without changing other defaults
    And saved dash length 0 and speed 513 normalize to 8 and 64 after reload without changing other defaults
    And saved dash length 1.5 and speed NaN normalize to 8 and 64 after reload without changing other defaults

  @workflow-dash-settings
  Scenario: Dash length and speed accept bounded integers and retain a paused speed after reload
    Then dash length and speed controls reject invalid drafts and persist their independent limits

  @workflow-node-symbols
  Scenario: Node symbols change immediately and persist without hiding workflow actions
    Then the Node symbols preference hides existing node headings and footers across reload and restores them independently of actions

  @application-tooltips
  Scenario: Tooltips can be disabled without disabling their controls and the preference survives reload
    Then the Tooltips preference applies immediately and persists while controls remain usable
