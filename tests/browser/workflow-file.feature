# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: File upload nodes
  Scenario: Uploaded data survives reload and CSV options can be corrected
    Given a workflow with 1 instances of "Example object response"
    Then I can upload typed workflow files and correct CSV detection

  Scenario: Large file previews use a bounded scroll area and load more on demand
    Given a workflow with 1 instances of "Example object response"
    Then file previews limit visible rows and load additional lines on demand

  Scenario: Uploads create connected data structures and reconcile replacements
    Given a workflow with 1 instances of "Example object response"
    Then uploaded files create nested output panels and preserve compatible field connections

  Scenario: CSV Item attributes connect to scalar inputs and execute once per row
    Given a workflow with 1 instances of "Example array response"
    Then CSV Item connections send correlated scalar requests for every row

  Scenario Outline: Binary uploads survive reload and use the receiving transport
    Given a workflow with 1 instances of "Example object response"
    Then file nodes send original bytes through "<transport>" inputs after reload
    Examples:
      | transport                |
      | application/octet-stream |
      | multipart/form-data      |
