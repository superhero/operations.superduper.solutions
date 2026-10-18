# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Navigation modal lifetime
  Scenario Outline: Graph shortcuts remain suspended throughout animated dismissal
    Given a workflow with 2 instances of "List projects"
    Then dismissing animated mobile navigation with "<dismissal>" protects the graph until it is gone

    Examples:
      | dismissal |
      | Close     |
      | Escape    |

  Scenario Outline: Responsive navigation preserves the active document dialog
    Given a workflow with 2 instances of "List projects"
    Then resizing an open desktop catalog preserves the "<dialog>" dialog focus and trap

    Examples:
      | dialog           |
      | Saved workflows |
      | Unsaved changes  |

  Scenario Outline: Dismissing mobile navigation preserves the reading position
    Given I switch to the settings workspace
    Then dismissing mobile navigation preserves reading position with "<motion>" motion

    Examples:
      | motion        |
      | no-preference |
      | reduce        |

  Scenario: Mobile destinations wait for the closing Sheet to disappear
    Given a workflow with 2 instances of "List projects"
    Then animated navigation completes dismissal before changing workspace or adding an operation

  Scenario: Reopening navigation cancels the interrupted destination
    Given a workflow with 2 instances of "List projects"
    Then reopening navigation during keyboard selection cancels that destination
