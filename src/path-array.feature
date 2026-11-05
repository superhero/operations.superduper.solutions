# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Simple path lists and actionable parameter diagnostics
  Scenario: Path lists retain item boundaries in both simple explode modes
    Then simple path lists preserve reserved characters Unicode and primitive types

  Scenario: Unsupported parameters are all identified during service discovery
    Then parameter diagnostics name every unsupported field and its serialization mode

  Scenario: Invalid path values stop before request dispatch
    Then path lists reject missing values invalid members and traversal against the correct field

  Scenario: Private and public transports use the same canonical path encoding
    Then private path lists preserve delimiters credentials and approval boundaries

  Scenario: The bundled ECB data operation uses supported path lists
    Then ECB data queries prepare their native path and current discovery descriptor

  Scenario: Path template mismatches identify missing and unused declarations
    Then both importers name missing and unused path parameters without guessing bindings

  Scenario: Reviewed ECB registration bindings enable both queries
    Then ECB registration queries preserve upstream data and prepare their declared identifiers

  Scenario: ECB registration corrections reject incompatible contracts
    Then ECB registration corrections are repeatable and preserve reviewed contract boundaries
