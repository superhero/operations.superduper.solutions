# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-files
Feature: Uploaded workflow data
  Scenario: JSON data retains its native output type
    Then uploaded JSON preserves native values and types
  Scenario: CSV dialects preserve text and detect numeric columns
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
  Scenario: Array structures preserve declared and observed item ranges
    Then array structures preserve item bounds and validate stored ranges
  Scenario: Numeric inference examines every row and falls back per column
    Then CSV columns become numbers only when every value is numeric
  Scenario: File structures share the existing output connector
    Then file structure attachments share one output and normalize older handles
  Scenario: Empty uploaded values do not mark a field required
    Then uploaded fields with empty values are optional while zero and false remain required
  Scenario: Boolean inference examines the entire column
    Then CSV columns become booleans only when every cell is true or false
  Scenario: Item fields run once per row with correlated columns and downstream outputs
    Then CSV item connections run downstream operations once per aligned row
  Scenario: Row execution retries the same row and stops without sending later requests
    Then CSV row execution retains failed rows and respects ending the run
  Scenario: Row execution handles filters empty arrays and independent starting paths
    Then CSV row execution filters rows and keeps independent roots separate
  Scenario: Large batches keep the operation limit per row and reject mismatched sources
    Then CSV row execution supports large batches and rejects unaligned inputs
  Scenario: Item connections match scalar types without losing whole-array destinations
    Then Item connection validation distinguishes rows collections and incompatible types
  Scenario: Each CSV row can execute a nested workflow
    Then CSV rows supply nested workflow inputs independently
  Scenario: File fields retain their scalar types when routed through utility nodes
    Then file fields expose their item or native types to switches and casts
