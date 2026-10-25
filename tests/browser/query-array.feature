# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@query-array-ui
Feature: Query array dispatch from saved workflows
  Background:
    Given I create a vault in the Secrets settings and save a synthetic credential

  Scenario Outline: Query array delimiters survive the selected execution path
    Then a saved <path> workflow preserves comma array bytes through its real request path
    Examples:
      | path    |
      | public  |
      | private |
