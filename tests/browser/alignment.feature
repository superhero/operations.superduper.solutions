# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Frontend alignment interactions
  Scenario: Direct catalog selection and keyboard help preserve navigation context
    Then catalog paths, focus and tooltip dismissal behave consistently

  Scenario: Prompt keyboard submission respects composition and modifiers
    Then prompt keyboard controls preserve editing and search deliberately

  Scenario: Unicode validation identifies the field without losing valid decimal input
    Given I open the "Create task" operation from the catalog
    Then Unicode titles and decimal estimates can be corrected inline

  Scenario: Mobile navigation isolates the selected graph
    Given a workflow with 2 instances of "List projects"
    Then mobile navigation protects graph shortcuts and returns useful focus

  Scenario: Unsaved changes and removal failures stay inside their dialogs
    Given a workflow with 2 instances of "List projects"
    Then document dialogs allow cancellation and storage-error recovery

  Scenario: A superseded asynchronous import cannot replace a new document
    Given a workflow with 2 instances of "List projects"
    When I name the workflow "Existing plan" and wait for autosave
    Then a delayed import cannot supersede New

  Scenario: Motion follows live accessibility preferences
    Then ambient and navigation movement honor live reduced motion

  Scenario: Repeated nodes and responsive layout retain usable focus
    Given a workflow with 2 instances of "List projects"
    Then repeated nodes and short viewports remain usable

  Scenario: Step navigation retargets transitions without exposing inactive controls
    Then step motion preserves focus and inactive-panel isolation

  Scenario: Operation navigation preserves expanded details at the top
    When I search for the operation "List projects"
    And I open the "List projects" result
    Then returning to Operation preserves expanded details and the page top with either motion preference

  Scenario: Dashed connections respond to live motion preferences
    Given a workflow with 2 instances of "List projects"
    When I connect the first operation to the second
    And I enable grid snapping and curved dashed connections
    Then connection movement responds without changing the saved plan

  Scenario: Workspace switching restores the draft reading position
    Given I open the "Create task" operation from the catalog
    Then a workspace round trip preserves input focus and scroll
