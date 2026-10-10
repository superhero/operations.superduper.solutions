# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Browser workflow autosave
  Scenario: An untouched blank workflow does not create a saved document
    When I switch to the workflow workspace
    Then the untouched workflow stays out of browser storage and has no Save action

  Scenario: Pending workflow edits guard reload until IndexedDB saving finishes
    Given a connected saved QA workflow
    When I rename the workflow and check reload protection before saving finishes
    Then the last edit and connected graph are restored from browser storage

  Scenario: New workflow flushes a pending edit without showing a confirmation
    When I switch to the workflow workspace
    Then starting a new workflow immediately preserves the preceding draft

  Scenario: Leaving the workflow workspace flushes the latest edit
    Given a connected saved QA workflow
    Then switching to Settings immediately preserves the latest workflow name

  Scenario: Failed autosave preserves the draft and offers recovery
    When I switch to the workflow workspace
    Then a failed autosave protects the draft until browser storage recovers

  Scenario: Deleting the active workflow does not recreate it until it is edited
    Given a connected saved QA workflow
    Then the removed active workflow stays deleted until the next edit

  Scenario: Autosave does not overwrite another tab's changed or removed workflow
    Given a connected saved QA workflow
    Then changes from another browser tab are protected from stale autosave

  Scenario: Reopening the current edited workflow keeps autosave working for mapped version three plans
    Given a workflow ready to map Get project to Create task
    When I map the project identifier between those operations
    And I describe this workflow as "Preserve mapped version three autosave."
    And I name the workflow "Mapped autosave plan" and wait for autosave
    Then reopening that workflow during an edit allows its next edit to autosave
