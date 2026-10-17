# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-files
Feature: Uploaded workflow data
  Scenario: JSON data retains its native output type
    Then uploaded JSON preserves native values and types
  Scenario: CSV dialects preserve cells without numeric coercion
    Then uploaded CSV supports common delimiters quotes headers and line endings
  Scenario: Invalid and excessive input is rejected
    Then workflow uploads reject unsupported malformed and excessive data
  Scenario: Encoded files and saved data remain usable
    Then workflow uploads decode supported text encodings and validate saved data
  Scenario: Saved upload nodes feed typed workflow inputs
    Then uploaded file nodes persist and supply operation inputs
  Scenario: File types propagate through utility nodes and history
    Then file node types propagate through switches and change descriptions
  Scenario: CSV rows become the JSON body of a request
    Then uploaded CSV rows execute as structured request data
  Scenario: Uploaded structures create bounded typed output panels
    Then uploaded structures project nested fields and CSV columns
  Scenario: Replacing data reconciles panels and existing mappings
    Then replacing file structures preserves matching panels and removes invalid mappings
  Scenario: Nested uploaded fields supply operation inputs
    Then uploaded nested fields supply executable operation inputs
