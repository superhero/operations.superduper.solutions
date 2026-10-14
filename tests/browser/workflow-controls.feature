# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Workflow utility controls and reusable plans
  Routing, annotations and saved workflows remain editable and persist locally.

  Scenario: Routing gates casts comments and descriptions survive saving
    Given a workflow with editable routing controls and a comment
    When I connect a numeric cast to the switch
    And I edit the switch and remove a connected extra gate
    And I write a safely formatted workflow comment
    And I describe this workflow as "Route numeric values and keep the review notes."
    And I name the workflow "Routing notes" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the routing controls comment and description retain their edits

  Scenario: Saved workflows insert as reusable nodes without changing their source
    Given a reusable saved project workflow and an empty parent plan
    When I insert the saved project workflow from the catalog
    And I name the workflow "Parent with reusable lookup" and wait for autosave
    And I reload and reopen the workflow workspace
    Then the reusable workflow keeps its ports and embedded definition

  Scenario: A self-reference follows workflow renaming without changing its snapshot
    Given a saved workflow containing a reference to itself
    When I name the workflow "Renamed self-reference" and wait for autosave
    Then the self-reference shows "Renamed self-reference" with its original snapshot
    When I reload and reopen the workflow workspace
    Then the self-reference shows "Renamed self-reference" with its original snapshot

  Scenario: Existing references follow source renaming without rewriting their parent
    Given a parent workflow containing two copies of a saved workflow
    When the saved source workflow is renamed to "Renamed source workflow"
    Then both references show "Renamed source workflow" without changing their saved definitions
    When the saved source workflow is removed
    Then both references show "Original source workflow" without changing their saved definitions

  Scenario: Removing one saved workflow supports cancellation and recovery from a storage failure
    Given three saved workflow control examples
    When I cancel removing a saved workflow from its row
    Then all saved workflow control examples remain
    When removing one saved workflow encounters a storage failure
    Then the saved workflow is retained for retry
    When I retry removing the workflow after storage recovers
    Then only that saved workflow is removed

  Scenario: Description editing keeps its draft through a failed save
    Given a workflow with editable routing controls and a comment
    When a workflow description save encounters a storage failure
    Then the description draft remains available for retry
    When I continue editing the description after the failed save
    And I retry saving the workflow description
    Then the recovered description is saved locally

  Scenario: Utility controls and description editing fit a narrow viewport
    Given I use a viewport of 390 by 844 pixels
    And a workflow with editable routing controls and a comment
    Then the utility controls remain usable in the narrow canvas
    When I describe this workflow as "A compact review workflow."
    Then the page fits the viewport horizontally

  Scenario: Retrying a saved library read preserves the edited current draft
    Given three saved workflow control examples
    When I edit the current plan and fail to open the saved library
    Then the saved library offers a retry without replacing the draft
    When I retry loading the saved library after storage recovers
    Then the saved choices return and the edited draft remains intact

  Scenario: Imported routing operands stay intact until their input type changes
    Given an imported workflow with previously saved routing operands
    Then importing and editing metadata retain the saved routing operands
    When I change the imported cast output to Number
    Then the switch adapts its operand to the changed input type
