# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Browser-local Git workflow history
  Background:
    Given two independent Git workflows with saved versions

  Scenario: Each workflow has real isolated Git commits and predictable working JSON
    Then each workflow has an independent Git repository in IndexedDB
    And workflow preferences and unchanged content create no new commits

  Scenario: History messages describe their actual parent changes without rewriting legacy commits
    Then workflow history records useful messages and derives legacy titles from the correct parents

  Scenario: Opening history does not change the editor or its persisted working file
    When I open workflow history
    Then history offers direct restore actions without changing the current workflow

  Scenario: Restoring a version creates a new commit without losing later versions
    When I open workflow history
    And I restore the earliest workflow version
    Then the historical graph is restored while both workflows keep their history

  Scenario: Undo and redo survive reload and an edit after undo clears only redo
    Then workflow undo and redo remain available across reloads

  Scenario: Repeated edits from an earlier version preserve distinct abandoned branches
    Then repeated edits after undo preserve the real Git branch tree
    And the mobile history tree shows stashed futures without changing the workflow
    And explicitly restoring a stashed version appends a commit while preserving all branches

  Scenario: Repeating identical abandoned content in the same second creates a distinct fork
    Then an identical same-second edit preserves a distinct abandoned commit

  Scenario: The first node added to a new workflow can be undone and redone
    Then the first workflow edit has an empty baseline for undo

  Scenario: Overlapping writes cannot mix workflow snapshots or replace a newer revision
    Then simultaneous workflow saves serialize and reject the stale snapshot

  Scenario: Completed edits produce individual versions without splitting typing or dragging
    Then quick structural edits create separate workflow commits
    And returning to the original text while saving preserves both completed edits
    And a paused text edit and a paused node drag each create only one completed version

  Scenario: An interrupted catalogue update recovers the durable Git commit on reload
    Then a committed workflow survives an interrupted catalogue update without a duplicate commit

  Scenario Outline: Interrupted <operation> finalization recovers without losing commits or branches
    Then an interrupted "<operation>" recovers the selected version and exact Git references

    Examples:
      | operation |
      | fork      |
      | undo      |
      | redo      |

  Scenario: Migrating an existing browser collection is complete and idempotent
    Then existing localStorage workflows migrate once and retain their identifiers

  Scenario: A legacy pending Undo migrates without losing prior Git commits
    Then an interrupted append-only Undo migrates to real commit navigation
