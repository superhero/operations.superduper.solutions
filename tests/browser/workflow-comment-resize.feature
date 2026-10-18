# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Resizable workflow comments
  Scenario: Comment side and corner handles resize and persist without a native textarea grip
    Given a workflow with 1 instances of "Get project"
    Then I can resize a comment from its sides and corners and retain its size
