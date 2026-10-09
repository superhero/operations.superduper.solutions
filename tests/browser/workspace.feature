# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Browser operations workspace
  People can discover demo operations, review requests, and keep visual plans locally.

  Scenario: A misspelled operation name finds a useful result
    When I search for the operation "List projetcs"
    Then the results offer the "List projects" form
    When I review the matching details
    Then the matching explanation describes spelling similarity
    When I close the matching details
    And I open the "List projects" result
    Then the "List projects" form is displayed

  Scenario: An unrelated prompt explains how to recover
    When I search for the operation "unrelated zeppelins"
    Then no matching operations are shown
    When I choose to edit the prompt
    Then the prompt still contains "unrelated zeppelins"

  Scenario: Required inputs become a typed request with an encoded path
    Given I open the "Create task" operation from the catalog
    When I try to prepare the request
    Then "Project ID" is an invalid required input
    And no prepared request is displayed
    When I enter these operation inputs:
      | label           | value                |
      | Project ID      | roadmap / 2026       |
      | Title           | Review documentation |
      | Priority        | high                 |
      | Estimated hours | 2.5                  |
    And I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/roadmap%20%2F%202026/tasks","query":{},"body":{"title":"Review documentation","priority":"high","estimate":2.5}}
      """
    And the page explains that no request has been sent

  Scenario: Query validation and editing keep request previews current
    Given I open the "List projects" operation from the catalog
    When I enter these operation inputs:
      | label        | value           |
      | Project name | Design & review |
      | Result limit | 101             |
    And I try to prepare the request
    Then "Result limit" is outside its allowed numeric range
    When I enter these operation inputs:
      | label        | value |
      | Result limit | 5     |
    And I prepare the request
    Then the prepared request is:
      """
      {"method":"GET","path":"/projects","query":{"name":"Design & review","limit":5}}
      """
    When I edit the inputs and change "Result limit" to "8"
    Then the previous request preview cannot be reopened
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"GET","path":"/projects","query":{"name":"Design & review","limit":8}}
      """

  Scenario: The catalog exposes schema details and typed choices
    Given I open the "Update task" operation from the catalog
    When I expand the operation details
    Then the operation identifier is "demo:updateTask"
    And "Priority" offers the choices "low, normal, high"
    And "Completed" offers the choices "true, false"
    When I enter these operation inputs:
      | label     | value    |
      | Task ID   | task/one |
      | Priority  | normal   |
      | Completed | false    |
    And I prepare the request
    Then the prepared request is:
      """
      {"method":"PATCH","path":"/tasks/task%2Fone","query":{},"body":{"priority":"normal","completed":false}}
      """
    When I edit the inputs and change "Completed" to ""
    And I prepare the request
    Then the prepared request is:
      """
      {"method":"PATCH","path":"/tasks/task%2Fone","query":{},"body":{"priority":"normal"}}
      """

  Scenario: The selected theme survives a reload
    When I enable the dark theme
    And I reload the workspace
    Then the dark theme remains selected

  Scenario: The catalog works as desktop navigation and a mobile dialog
    When I open and close the desktop catalog
    And I use a viewport of 390 by 844 pixels
    And I open the mobile catalog
    Then the mobile catalog is a visible dialog
    When I choose the "Get project" operation from the catalog
    Then the mobile catalog is closed
    And the "Get project" form is displayed
    And the page fits the viewport horizontally

  Scenario: Connected operation instances and view options survive local saving
    Given a workflow with 2 instances of "List projects"
    When I connect the first operation to the second
    And I enable grid snapping and curved dashed connections
    And I save the workflow as "Project review"
    And I press Delete while the saved-workflow dialog is open
    Then the workflow still contains 2 instances of "List projects"
    When I reload and reopen the workflow workspace
    Then the workflow is named "Project review"
    And it contains one connection
    And grid snapping and curved dashed connections remain enabled

  Scenario Outline: Switching all three workspaces preserves drafts and protects the hidden graph
    Given I use a viewport of <width> by 844 pixels
    And I open the "List projects" operation from the catalog
    When I enter these operation inputs:
      | label        | value       |
      | Project name | Draft query |
      | Result limit | 7           |
    And I add "List projects" through the workflow catalog
    And I switch to the settings workspace
    And I press Delete in Settings
    Then Settings is the only selected workspace
    When I switch to operations and press Delete
    Then the "List projects" form is displayed
    And the input "Project name" still contains "Draft query"
    And the input "Result limit" still contains "7"
    When I switch to the workflow workspace
    Then the workflow still contains 1 instance of "List projects"
    When I switch to the settings workspace
    And I choose the "Get project" operation from the catalog
    Then the "Get project" form is displayed
    When I switch to the workflow workspace
    Then the workflow still contains 1 instance of "List projects"

    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario: Exported plans import as a separate local document
    Given a workflow with 2 instances of "List projects"
    When I connect the first operation to the second
    And I save the workflow as "Portable review"
    And I export the workflow
    And I start a new workflow
    Then the new workflow is empty and not saved
    When I import the exported workflow
    Then the workflow is named "Portable review"
    And the workflow still contains 2 instances of "List projects"
    And it contains one connection
    When I export the workflow again
    Then the imported plan preserves its graph under a new document identity

  Scenario: Invalid imports report the cause and preserve the current plan
    Given a workflow with 2 instances of "List projects"
    When I save the workflow as "Keep this plan"
    And I import an unsupported workflow version
    Then the import error names the file and unsupported version
    And the workflow is named "Keep this plan"
    And the workflow still contains 2 instances of "List projects"

  Scenario: A graph remains visible after switching to a narrow viewport
    Given a workflow with 2 instances of "List projects"
    When I switch to the operations workspace
    And I use a viewport of 390 by 844 pixels
    And I switch to the workflow workspace
    Then at least one complete operation node is visible inside the canvas
    And the page fits the viewport horizontally
