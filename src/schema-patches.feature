# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Reviewable schema corrections and structured upstream merges
  Published changes and local edits retain their meaning when schemas are updated.

  Scenario: Independent upstream edits preserve local schema changes
    Then schema merges preserve unrelated edits deletions and identical changes

  Scenario: Overlapping changes need explicit field decisions
    Then schema merge conflicts distinguish missing null arrays and concurrent object edits

  Scenario: Property names and diff limits remain safe
    Then schema merge paths preserve special keys and bound changed-field reports

  Scenario: Resolved upstream corrections are not applied twice
    Then reviewed schema corrections preserve upstream-fixed data and reject unknown recipes
