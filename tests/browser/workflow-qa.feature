# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Workflow replacement and export regressions
  Scenario Outline: Canceling a replacement preserves the draft and useful focus
    Given two saved QA workflows and an edited current draft
    When I cancel a pending <action> replacement with <dismissal>
    Then the edited QA draft and useful focus are retained after <action>

    Examples:
      | action | dismissal |
      | Open   | Cancel    |
      | Open   | Escape    |
      | New    | Cancel    |
      | Import | Escape    |

  Scenario Outline: Opening a saved workflow resolves the requested snapshot
    Given two saved QA workflows and an edited current draft
    When I open the <target> saved QA workflow with "<choice>"
    Then the <target> QA workflow reflects "<choice>" and storage remains consistent

    Examples:
      | target  | choice            |
      | current | Save and continue |
      | current | Discard changes   |
      | other   | Save and continue |
      | other   | Discard changes   |

  Scenario: Hovering a connection preserves its generous selection area
    Given a connected saved QA workflow
    Then I can select the connection beside its visible line while hovered

  Scenario: A near-limit imported workflow can be exported and imported again
    Given a compact QA workflow file just below the import size limit
    When I import, export and reimport the near-limit QA workflow
    Then the near-limit QA workflow preserves its graph under a new identity

  Scenario: Export rejects a workflow that would exceed the import size limit
    Given a locally saved QA workflow larger than the import size limit
    Then exporting the oversized QA workflow explains how to reduce it without downloading
