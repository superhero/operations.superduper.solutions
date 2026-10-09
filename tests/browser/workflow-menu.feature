# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Workflow document actions menu
  Scenario: Keyboard actions protect the selected graph and preserve navigation
    Given a workflow with 2 instances of "List projects"
    Then the workflow actions menu protects graph shortcuts and restores focus without closing navigation
