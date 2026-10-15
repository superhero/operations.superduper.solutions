# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @documentation-workflows
Feature: Lightweight documentation workflow routing
  Documentation changes use trusted validation without running application code.
  The selected destination receives the change without a release or synchronization.

  Scenario Outline: Documentation branches avoid every regular CI and publishing job
    Given the documentation workflow configuration
    When the documentation source is "<source>" targeting "<target>"
    Then the dedicated documentation job is "<outcome>"
    And documentation branches skip every regular job on that target

    Examples:
      | source       | target  | outcome |
      | docs/readme  | main    | enabled |
      | docs/readme  | develop | enabled |
      | docs/readme  | release/1.2.3 | enabled |
      | bugfix/docs  | main    | skipped |
      | feature/docs | develop | skipped |

  Scenario: Documentation-only advances on a release source do not restart publication
    Then a documentation-only release advance cannot reach application or publication jobs

  Scenario: Documentation validation cannot execute proposed automation
    Given the documentation workflow configuration
    Then documentation validation uses only trusted default-branch code and pinned Git objects
    And the documentation workflow performs no testing, deployment, tagging or synchronization

  Scenario: Documentation writes require successful validation and a trusted pull request
    Given the documentation workflow configuration
    Then documentation writes follow validation with restricted credentials
    And documentation merging shares the global integration queue and destination merge lock
