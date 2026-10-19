# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Browser development resources have a bounded lifetime
  Scenario: Compiled servers remain reusable only within their feature
    Then a feature transition closes its idle development server while same-feature entries preserve it

  Scenario: Cleanup failures stay visible and do not skip other owners
    Then a failed browser resource cleanup still releases other resources and permits retry

  Scenario: The complete library has an exclusive bounded test phase
    Then browser project scheduling covers every selected feature once without overlapping the complete library

  Scenario: Focused browser selections keep their intended scope
    Then browser project scheduling does not add unselected features or empty projects

  Scenario: Serialized phase results remain bound to their feature inventory
    Then browser blob validation accepts each declared phase and rejects swapped or unrelated projects
