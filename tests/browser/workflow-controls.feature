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
    And I save the workflow as "Routing notes"
    And I reload and reopen the workflow workspace
    Then the routing controls comment and description retain their edits

  Scenario: Saved workflows insert as reusable nodes without changing their source
    Given a reusable saved project workflow and an empty parent plan
    When I insert the saved project workflow from the catalog
    And I save the workflow as "Parent with reusable lookup"
    And I reload and reopen the workflow workspace
    Then the reusable workflow keeps its ports and embedded definition

  Scenario: Bulk workflow deletion can recover from a storage failure
    Given three saved workflow control examples
    When I select two saved workflows for deletion
    And the bulk deletion encounters a storage failure
    Then the selected saved workflows are retained for retry
    When I retry the bulk deletion after storage recovers
    Then only the unselected saved workflow remains

  Scenario: Description editing keeps its draft through a failed save
    Given a workflow with editable routing controls and a comment
    When a workflow description save encounters a storage failure
    Then the description draft remains available for retry
    When I retry saving the workflow description
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
