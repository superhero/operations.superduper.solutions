# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Workflow toolbar actions
  Scenario: Direct keyboard actions protect the selected graph and preserve navigation
    Given a workflow with 2 instances of "List projects"
    Then direct workflow actions protect graph shortcuts and restore focus without closing navigation
