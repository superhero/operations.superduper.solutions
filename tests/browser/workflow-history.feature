# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Browser-local Git workflow history
  Background:
    Given two independent Git repositories with saved versions

  Scenario: Each workflow has real isolated Git commits and predictable working JSON
    Then each workflow has an independent Git repository in IndexedDB
    And workflow preferences and unchanged content create no new commits

  Scenario: History messages describe their actual parent changes without rewriting legacy commits
    Then workflow history records useful messages and derives legacy titles from the correct parents

  Scenario: Opening history does not change the editor or its persisted working file
    Given I open the latest saved history workflow
    When I open workflow history
    Then history offers selectable version cards without changing the current workflow

  Scenario: Selecting an earlier version moves to its existing commit and preserves later work
    Given I open the latest saved history workflow
    When I open workflow history
    And I select the earliest workflow version
    Then the historical graph is selected without creating a commit or changing another workflow
    And editing the selected version forks from that existing commit

  Scenario: Keyboard selection locks version cards until the selected workflow is ready
    Given I open the latest saved history workflow
    When I open workflow history
    Then keyboard activation selects the existing version while competing cards are disabled

  Scenario: Version selection rejects stale and unrelated revisions without changing history
    Then checkout rejects invalid revisions and selecting the current revision creates no changes

  Scenario: Interrupted version selection recovers the selected commit and preserved branches
    Given I open the latest saved history workflow
    Then an interrupted checkout recovers the exact selected commit and Git references

  Scenario: Undo and redo survive reload and an edit after undo clears only redo
    Given I open the latest saved history workflow
    Then workflow undo and redo remain available across reloads

  Scenario: Repeated edits from an earlier version preserve distinct abandoned branches
    Given I open the latest saved history workflow
    Then repeated edits after undo preserve the real Git branch tree
    And the mobile history tree shows stashed futures without changing the workflow
    And selecting a stashed version moves to its existing commit while preserving all branches
    And the explicit repository restore API still appends a commit

  Scenario: Repeating identical abandoned content in the same second creates a distinct fork
    Then an identical same-second edit preserves a distinct abandoned commit

  Scenario: The first node added to a new workflow can be undone and redone
    Given I open the latest saved history workflow
    Then the first workflow edit has an empty baseline for undo

  Scenario: Overlapping writes cannot mix workflow snapshots or replace a newer revision
    Then simultaneous workflow saves serialize and reject the stale snapshot

  Scenario: Completed edits produce individual versions without splitting typing or dragging
    Given I open the latest saved history workflow
    Then quick structural edits create separate workflow commits
    And returning to the original text while saving preserves both completed edits
    And a paused text edit and a paused node drag each create only one completed version

  Scenario: An interrupted catalogue update recovers the durable Git commit on reload
    Given I open the latest saved history workflow
    Then a committed workflow survives an interrupted catalogue update without a duplicate commit

  Scenario Outline: Interrupted <operation> finalization recovers without losing commits or branches
    Given I open the latest saved history workflow
    Then an interrupted "<operation>" recovers the selected version and exact Git references

    Examples:
      | operation |
      | fork      |
      | undo      |
      | redo      |

  Scenario: Legacy browser collections remain untouched while Git workflows keep working
    Given I open the latest saved history workflow
    Then legacy localStorage workflows are ignored and untouched while Git workflows survive reload

  Scenario: A legacy pending Undo migrates without losing prior Git commits
    Given I open the latest saved history workflow
    Then an interrupted append-only Undo migrates to real commit navigation
