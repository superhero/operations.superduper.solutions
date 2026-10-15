# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @integration-recovery
Feature: Resume publication without rewriting a merged release changelog
  Exact merged release recovery reads its pinned source even after branch deletion.
  It never opens another changelog documentation PR or changes published content.

  Scenario Outline: Recovery validates <condition> from the pinned release
    Given a pinned merged release with "<condition>"
    When the merged release changelog recovery script runs
    Then merged release changelog recovery is "<outcome>" without writes

    Examples:
      | condition                       | outcome     |
      | a canonical versioned changelog | ready       |
      | a deleted release branch        | ready       |
      | unreleased Latest entries       | unversioned |
      | a different release version     | unversioned |
      | a symbolic-link changelog       | irregular   |
      | an executable changelog         | irregular   |
      | a changelog directory           | irregular   |
      | a missing changelog             | irregular   |
