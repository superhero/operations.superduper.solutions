# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Browser operations workspace
  People can discover demo operations, review requests, and keep visual plans locally.

  Scenario: A misspelled operation name finds a useful result
    When I search for the operation "List projetcs"
    Then the results offer the "Example array response" form
    When I review the matching details
    Then the matching details show ranked operation comparisons
    When I close the matching details
    And I open the "Example array response" result
    Then the "Example array response" form is displayed

  Scenario: An unrelated prompt offers the nearest five operations and remains editable
    When I search for the operation "unrelated zeppelins"
    Then the five nearest operations are shown
    When I choose to edit the prompt
    Then the prompt still contains "unrelated zeppelins"

  Scenario: Required inputs become a typed request with an encoded path
    Given I open the "Example POST body" operation from the catalog
    When I try to prepare the request
    Then "Path value" is an invalid required input
    And no prepared request is displayed
    When I enter these operation inputs:
      | label           | value                |
      | Path value      | roadmap / 2026       |
      | Title           | Review documentation |
      | Priority        | high                 |
      | Number value | 2.5                  |
    And I prepare the request
    Then the prepared request is:
      """
      {"method":"POST","path":"/projects/roadmap%20%2F%202026/tasks","query":{},"body":{"title":"Review documentation","priority":"high","estimate":2.5}}
      """
    And operation metadata identifies server URL "https://example.com"

  Scenario: Query validation and editing keep request previews current
    Given I open the "Example array response" operation from the catalog
    When I enter these operation inputs:
      | label        | value           |
      | Name | Design & review |
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
    When I restart with the same inputs and change "Result limit" to "8"
    Then the previous request preview cannot be reopened
    When I prepare the request
    Then the prepared request is:
      """
      {"method":"GET","path":"/projects","query":{"name":"Design & review","limit":8}}
      """

  Scenario: The catalog exposes schema details and typed choices
    Given I open the "Example PATCH body" operation from the catalog
    When I expand the operation details
    Then the operation identifier is "demo:updateTask"
    And "Priority" offers the choices "low, normal, high"
    And "Completed" offers the choices "true, false"
    When I enter these operation inputs:
      | label     | value    |
      | Path value   | task/one |
      | Priority  | normal   |
      | Completed | false    |
    And I prepare the request
    Then the prepared request is:
      """
      {"method":"PATCH","path":"/tasks/task%2Fone","query":{},"body":{"priority":"normal","completed":false}}
      """
    When I restart with the same inputs and change "Completed" to ""
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
    When I choose the "Example object response" operation from the catalog
    Then the mobile catalog is closed
    And the "Example object response" form is displayed
    And the page fits the viewport horizontally

  Scenario: Connected operation instances and view options survive local saving
    Given a workflow with 2 instances of "Example array response"
    When I connect the first operation to the second
    And I enable grid snapping and curved dashed connections
    And I name the workflow "Project review" and wait for autosave
    And I press Delete while the saved-workflow dialog is open
    Then the workflow still contains 2 instances of "Example array response"
    When I reload and reopen the workflow workspace
    Then the workflow is named "Project review"
    And it contains one connection
    And grid snapping and curved dashed connections remain enabled

  Scenario Outline: Switching workspaces preserves the graph and protects hidden shortcuts
    Given I use a viewport of <width> by 844 pixels
    And a workflow with 1 instances of "Example array response"
    When I switch to the settings workspace
    And I press Delete in Settings
    Then Settings is the only selected workspace
    When I switch to the workflow workspace
    Then the workflow still contains 1 instance of "Example array response"
    When I switch to the settings workspace
    And I add "Example object response" from the settings catalog
    Then the workflow still contains 1 instance of "Example array response"
    And the workflow still contains 1 instance of "Example object response"

    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario: Exported plans import as a separate local document
    Given a workflow with 2 instances of "Example array response"
    When I connect the first operation to the second
    And I name the workflow "Portable review" and wait for autosave
    And I export the workflow
    And I start a new workflow
    Then the new workflow is empty and not saved
    When I import the exported workflow
    Then the workflow is named "Portable review"
    And the workflow still contains 2 instances of "Example array response"
    And it contains one connection
    When I export the workflow again
    Then the imported plan preserves its graph under a new document identity

  Scenario: Invalid imports report the cause and preserve the current plan
    Given a workflow with 2 instances of "Example array response"
    When I name the workflow "Keep this plan" and wait for autosave
    And I import an unsupported workflow version
    Then the import error names the file and unsupported version
    And the workflow is named "Keep this plan"
    And the workflow still contains 2 instances of "Example array response"

  Scenario: A graph remains visible after switching to a narrow viewport
    Given a workflow with 2 instances of "Example array response"
    When I switch to the settings workspace
    And I use a viewport of 390 by 844 pixels
    And I switch to the workflow workspace
    Then at least one complete operation node is visible inside the canvas
    And the page fits the viewport horizontally

  Scenario Outline: Settings opens from the main header without opening navigation
    Then header Settings opens directly at viewport width <width>

    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario Outline: Settings slides over the workflow and preserves its layout
    Then the settings drawer preserves the workflow at width <width> with "<motion>" motion

    Examples:
      | width | motion        |
      | 1280  | no-preference |
      | 390   | no-preference |
      | 390   | reduce        |
      | 930   | no-preference |
      | 1149  | no-preference |

  Scenario: Settings and the left menu do not compete for header space
    Then opening Settings closes the left menu and keeps the Operations header left aligned

  Scenario: Full-height Settings temporarily replaces the viewport scrollbar
    Then Settings covers the viewport scrollbar without shifting or scrolling the workflow

  Scenario Outline: Workflow controls move beside Settings
    Given I use a viewport of <width> by 844 pixels
    And a workflow with 1 instances of "Example array response"
    Then Settings pushes the workflow minimap and button groups beside its pane

    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario: Wrapped workflow button groups have no unused outer width
    Given a workflow with 1 instances of "Example array response"
    Then wrapped workflow controls fit their occupied rows

  Scenario Outline: Workflow button groups stay compact at fractional width boundaries
    Given a workflow with 1 instances of "Example array response"
    Then workflow toolbar frames follow their occupied rows at wrapping boundaries with "<visibility>" buttons

    Examples:
      | visibility |
      | default    |
      | all        |

  Scenario: Settings leaves workflow tools and graph editing available
    Given a workflow with 1 instances of "Example array response"
    Then the workflow remains editable beside Settings

  Scenario Outline: Desktop navigation overlays the workflow without moving it
    Given I use a viewport of <width> by 844 pixels
    And a workflow with 1 instances of "Example array response"
    Then the left menu overlays the workflow without changing its layout

    Examples:
      | width |
      | 900   |
      | 1280  |

  Scenario: Settings blocks a cramped workspace and restores editing as space becomes available
    Given a workflow with 1 instances of "Example array response"
    Then Settings disables the workspace when insufficient space remains

  Scenario Outline: Empty workflow guidance follows the visible workspace
    Then empty workflow guidance stays centered beside menus at <width> pixels with "<motion>" motion

    Examples:
      | width | motion        |
      | 2048  | no-preference |
      | 1150  | reduce        |
      | 390   | reduce        |

  Scenario: Wide workspaces keep both panes open and compact workspaces retain one
    Then the catalog and settings coexist only when there is room for both panes

  Scenario: Settings width controls responsive pane layout and survives reload
    Then resizing Settings changes when the catalog closes and Settings becomes fullscreen

  Scenario: Navigation resizes above its existing minimum and keeps its width
    Then the left menu resizes from its right edge without becoming narrower than 320 pixels
