# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Serialized request contract boundaries
  Scenario: Invalid serialized headers and text bodies fail before transport
    Then serialized header form and text contracts reject malformed values

  Scenario: Multipart declarations retain their schema and resource boundaries
    Then multipart declarations reject incompatible encodings and excessive nesting

  Scenario: Multipart serialization is atomic and preserves MIME framing
    Then multipart values reject partial writes and preserve escaped wire metadata

  Scenario: Catalog metadata diagnostics preserve the source of invalid contracts
    Then catalog diagnostics name every registered correction and preserve malformed source reasons

  Scenario: Upload corrections retain inherited OpenAPI parameters
    Then native upload corrections preserve inherited parameters and path metadata

  Scenario: Schema corrections preserve required constraints and reject incomplete provenance
    Then schema corrections retain unrelated required fields and refuse incomplete roots or retired routes

  Scenario: Upload media kinds cannot inherit object prototype mappings
    Then upload media mappings reject unreviewed modes including inherited object names

  Scenario: Nameless upload source headers retain their parameter diagnostic
    Then nameless native upload headers retain a precise strict import diagnostic
