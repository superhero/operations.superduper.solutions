# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-processing
Feature: Explicit workflow processing and assertion routing
  Transform, Filter and Assert are independent nodes with typed, bounded behavior.

  Scenario: Encoding operations preserve Unicode and exact binary bytes
    Then workflow encoders preserve UTF-8 Base64 Base64url and hexadecimal values

  Scenario: JSON translation and field mapping retain types and safe property names
    Then workflow translation parses serializes selects and maps data without mutation

  Scenario: Hashing and keyed signing match independent vectors
    Then workflow cryptographic transforms match SHA256 HMAC and signed JWT contracts

  Scenario: Filters preserve Unicode characters array order and exclusive ranges
    Then workflow filters trim slice and select values with explicit predicates

  Scenario: Invalid operations parameters and input formats fail before producing output
    Then workflow processing rejects malformed configuration values encodings and limits

  Scenario: Processing nodes survive storage export clipboard and typed connection checks
    Then processing graphs retain independent node types configuration and meaningful changes

  Scenario: Binary processing inputs retain original file bytes through a visible cast
    Then binary processing connections insert the original file cast and decode exact bytes

  Scenario: A failed assertion forwards its original input through Failure
    Then a failed assertion forwards its input through Failure without an error

  Scenario: An unmatched assertion connection leaves the next step editable
    Then assertion outcomes leave unmatched connected fields available for manual input

  Scenario: Filtering and transformation execute before downstream inputs are prepared
    Then processing chains produce real values and support operation-free runs

  Scenario: Ending a run cancels its pending computation and discards its result
    Then workflow processing shares concurrent advancement and rejects cancelled results

  Scenario: Vault transformations remain opaque until private request injection
    Then private processing recipes inject transformed values and redact derived secrets

  Scenario: Assertions over vault values return only their predicate decision
    Then private assertions preserve opaque original references and allow manual fallback

  Scenario: Private recipes reject malformed references and excessive computation
    Then private processing rejects unknown recipes invalid references and structure limits

  Scenario: Mixed data and signing keys retain private references
    Then mixed private processing preserves nested references and keyed operations

  Scenario: Private processing bounds accumulated output independently of input size
    Then private processing bounds recipes and derived result retention

  Scenario: Array operations receive whole file columns
    Then array processing keeps file columns whole while text filters retain item types
