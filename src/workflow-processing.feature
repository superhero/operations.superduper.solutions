# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-processing
Feature: Explicit workflow processing and assertion routing
  Transform, Filter and Assert are independent nodes with typed, bounded behavior.

  Scenario: Connected assertion expectations preserve types and private comparisons
    Then assertion expectations accept typed connections and compare supplied public and private values

  Scenario: Scalar assertions check their input without a field path
    Then scalar assertions ignore saved field paths while structured assertions keep them

  Scenario: Stop nodes persist as input-only workflow nodes
    Then Stop nodes retain documents clipboard and input-only connection identities

  Scenario: Matched assertion outcomes activate Stop before the next step
    Then matched assertions stop immediately before another operation is prepared

  Scenario: Only supplied active connections trigger Stop
    Then unmatched inactive hidden and detached connections never activate Stop

  Scenario: Stop consumes any input without computing or decrypting it
    Then Stop accepts empty falsy binary and private inputs without processing or decryption

  Scenario: Stop after an operation prevents later requests
    Then an operation response connected to Stop prevents the following request

  Scenario: Stop ends the run across nested workflow boundaries
    Then Stop inside a nested workflow ends the complete run


  Scenario: Encoding operations preserve Unicode and exact binary bytes
    Then workflow encoders preserve UTF-8 Base64 Base64url and hexadecimal values

  Scenario: JSON translation and field mapping retain types and safe property names
    Then workflow translation parses serializes selects and maps data without mutation

  Scenario: Guided field mapping preserves saved paths names and value types
    Then field mapping rows preserve literal names nesting array items and saved execution

  Scenario: Select field belongs to Filter and preserves older saved processing
    Then Select field is a Filter while old Transform nodes and private recipes preserve their behavior

  Scenario: Parse JSON accepts every JSON value and restores legacy nodes
    Then Parse JSON accepts every JSON type and restores old selected types without narrowing output

  Scenario: Parse JSON connects directly under a matching receiving type assumption
    Then known JSON alternatives connect to matching ports and retain their types through routing

  Scenario: Parse JSON preserves runtime type checks and private processing
    Then parsed values satisfy receiving inputs at runtime without casting and stay private in vault recipes

  Scenario: Hashing and keyed signing match independent vectors
    Then workflow cryptographic transforms match SHA256 HMAC and signed JWT contracts

  Scenario: JWT auxiliary ports retain types and saved connection identities
    Then JWT key and Key ID ports preserve their declared types identity and manual fallback

  Scenario: JWT Key ID connections override manual settings during execution
    Then connected JWT Key IDs override manual values without coercion or fallback on unmatched routes

  Scenario: JWT Key ID connections preserve private processing boundaries
    Then JWT parameter references remain private and reject unsupported parameter recipes

  Scenario: Filters preserve Unicode characters array order and exclusive ranges
    Then workflow filters trim slice and select values with explicit predicates

  Scenario: Selected fields retain JSON types without a result-type setting
    Then Select field restores legacy settings as JsonValue and preserves each selected value

  Scenario: Filter bounds and paths accept typed connections with manual fallback
    Then connected Filter bounds and paths retain types execution and saved manual values

  Scenario: Filter expectations preserve connected types and private operands
    Then Filter array connections follow the condition and keep private comparisons opaque

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
