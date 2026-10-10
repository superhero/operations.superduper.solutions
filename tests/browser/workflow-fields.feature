# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Documented workflow fields and mappings
  Operations expose their documented input and response fields as editable workflow panels.

  Scenario: Added operations expose separate schema groups and nested fields
    Given a workflow with 1 instances of "List projects"
    Then List projects exposes its query parameters and nested project response
    When I add "Create task" through the workflow catalog
    Then Create task separates required path and request-body fields

  Scenario: A field mapping keeps its endpoints through saving and reloading
    Given a workflow ready to map Get project to Create task
    When I map the project identifier between those operations
    And I name the workflow "Field mapping review" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the project identifier mapping keeps its saved field endpoints

  Scenario: Hidden schema branches restore their fields and deleting an owner removes its graph
    Given a workflow with 1 instances of "List projects"
    When I hide and restore the root query input
    When I hide and restore the nested project response
    Then the nested response retains its field handles and operation
    When I delete the List projects owner
    Then its schema panels and connections are removed

  Scenario: Operation identity and documented response variants have labelled directional ports
    Given repeated operation nodes with documented response variants
    Then the identity row separates top input and bottom response ports

  Scenario: Dropping on a data panel snaps to the nearest valid input
    Given a workflow ready to map Get project to Create task
    When I drag the project identifier over the target panel body
    Then a preview points to the project identifier input
    When I drop the mapping on the panel body
    Then one mapping connects the project identifier fields

  Scenario: Escape cancels a mapping over a real port and the next drag succeeds
    Given a workflow ready to map Get project to Create task
    When I cancel a project identifier drag over its valid input port
    Then no field mapping or connection preview remains
    When I map the project identifier between those operations
    Then one mapping connects the project identifier fields

  Scenario: Legacy unnamed connections coexist with new schema panels after saving
    Given a legacy workflow with an unnamed operation connection
    When I add "Create task" through the workflow catalog
    And I name the workflow "Mixed generation workflow" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the legacy connection and new schema panels both remain usable

  Scenario: Click-to-connect starts a fresh mapping after Escape cancellation
    Given a workflow ready to map Get project to Create task
    When I cancel a project identifier drag over its valid input port
    Then no field mapping or connection preview remains
    When I map the project identifier by clicking the field handles
    Then one mapping connects the project identifier fields
    When I map the project identifier by clicking the field handles
    Then one mapping connects the project identifier fields

  Scenario: A hidden branch stays hidden after saving and reloads with a restore control
    Given a workflow with 1 instances of "List projects"
    When I hide the nested project response
    And I name the workflow "Hidden branch review" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the nested response remains hidden with its saved fields
    When I restore the nested project response
    Then the nested response retains its field handles and operation

  Scenario: Refusing an operation beyond coordinate limits preserves the original plan
    Given an imported legacy workflow near the coordinate limit
    When I try to add Create task beyond the coordinate limit
    Then the refused addition explains the limit and preserves the original graph
