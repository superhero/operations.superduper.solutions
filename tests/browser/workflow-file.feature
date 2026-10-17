# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: File upload nodes
  Scenario: Uploaded data survives reload and CSV options can be corrected
    Given a workflow with 1 instances of "Get project"
    Then I can upload typed workflow files and correct CSV detection

  Scenario: Large file previews use a bounded scroll area and load more on demand
    Given a workflow with 1 instances of "Get project"
    Then file previews limit visible rows and load additional lines on demand

  Scenario: Uploads create connected data structures and reconcile replacements
    Given a workflow with 1 instances of "Get project"
    Then uploaded files create nested output panels and preserve compatible field connections
