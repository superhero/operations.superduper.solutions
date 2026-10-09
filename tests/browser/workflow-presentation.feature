# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Workflow selection feedback
  Scenario Outline: Hover and keyboard focus preserve selected visual states
    Given a workflow with 2 instances of "List projects"
    Then graph selection feedback remains distinct in the "<theme>" theme

    Examples:
      | theme |
      | light |
      | dark  |
