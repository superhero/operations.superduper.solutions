# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@toolbar-controls
Feature: Documented workflow fields and mappings
  Operations expose their documented input and response fields as editable workflow panels.

  Scenario: Added operations expose separate schema groups and nested fields
    Given I add 1 instances of "List projects" from the catalog
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

  Scenario: Custom response properties retain mappings through creation, editing, history and reload
    Given a workflow with open HTTPBin response objects and Create task
    Then open response objects offer additional properties while closed inputs do not
    When I cancel adding a response property
    Then cancelling leaves the response graph unchanged
    When I finish editing properties with an unsaved field
    Then the property panel returns to its default view without changing the graph
    When I add the Text response header property "X-Project-Id"
    Then undo and redo preserve the added property identity
    When I try to add the same response header property again
    Then the duplicate property is refused without changing the graph
    When I map the added response header to the Create task project identifier
    And I name the workflow "Additional response property review" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the added response property and its mapping retain their saved identities
    And property edit mode makes only custom names and types editable
    When I cancel editing the response header property
    Then cancelling the property edit leaves the graph unchanged
    When I rename the response header property to "X-Project-Key"
    Then the renamed property keeps its mapping with the updated field identity
    When I name the workflow "Edited response property review" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the edited response property and mapping retain their saved identities
    When I remove the response header property from edit mode
    Then the property and its mapping are removed
    When I undo the property removal
    Then the edited response property and mapping retain their saved identities

  Scenario: Custom response properties support scalar types and editable nested objects
    Given a workflow with 1 instances of "HTTPBin GET request"
    When I add an Integer property named "limit" to the query values response
    Then the query values response exposes the added Integer output
    When I add an Object property to the query values response
    Then its child panel accepts a nested property without overlapping its parent
    When I change the added Object property to Integer
    Then changing the property type removes its old child panel
