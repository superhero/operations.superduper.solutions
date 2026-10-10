# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-change-message
Feature: Workflow history describes completed edits
  Scenario: Operation edits use names without listing their owned schema details
    Then workflow change messages describe added removed and moved operations

  Scenario: Field mapping messages identify both named endpoints
    Then workflow change messages describe connected and disconnected fields by their owners and labels

  Scenario: Configuration and document edits describe what changed
    Then workflow change messages distinguish settings names and descriptions

  Scenario: Grouped edits retain their meaningful changes
    Then workflow change messages summarize grouped edits without schema noise

  Scenario: Repeated nodes and large edits remain recognizable and concise
    Then workflow change messages number instances and bound long grouped labels

  Scenario: Data branches describe their own changes without duplicating their owners
    Then workflow change messages describe panel movement and subtree visibility

  Scenario: Utility connections name their input output and gate endpoints
    Then workflow change messages describe rewired utility and legacy connections

  Scenario: Removed nodes and hidden branches already explain their disappearing connections
    Then workflow change messages suppress connections removed with their nodes

  Scenario: Switch edits identify the changed gate and condition
    Then workflow change messages explain added removed changed and reordered gates

  Scenario: Comment edits preserve context and distinguish clearing from replacement
    Then workflow change messages identify edited comments and replacement nodes

  Scenario: Schema edits identify changed fields and panels
    Then workflow change messages describe field additions removals changes and ordering

  Scenario: Nested workflow messages reflect content changes while ignoring view preferences
    Then workflow change messages distinguish nested content from canvas preferences

  Scenario: Partial legacy snapshots still produce readable labels
    Then workflow change messages tolerate missing display references without exposing IDs
