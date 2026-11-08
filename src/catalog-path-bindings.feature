# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@catalog-path-bindings
Feature: Reviewed catalog path parameter corrections
  Scenario: Every reviewed correction preserves native identity and source provenance
    Then all 51 corrected catalog bindings retain their source identities and available models

  Scenario: Explicit identifiers remain required at preparation time
    Then corrected identifier bindings prepare exact paths and reject missing required values

  Scenario: Query migration and redundant aliases preserve the intended wire route
    Then corrected query parameters and removed aliases preserve their documented request locations

  Scenario: Changed source data cannot acquire an unrelated correction
    Then catalog path corrections reject drift unresolved references and provenance overwrites

  Scenario: Native path corrections keep private authority bound to their actual inputs
    Then a corrected organization user request retains private authorization and exact identifiers
