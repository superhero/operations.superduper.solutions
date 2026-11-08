# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@json-request-media
Feature: JSON request media variants
  Scenario: Structured JSON media preserve their declared content type
    Then JSON request media preserve typed objects ordered patch arrays and exact wire headers

  Scenario: Other representations keep explicit limitations
    Then JSON request media reject streams wildcards malformed types and unknown encodings

  Scenario: Private JSON variants retain credential isolation
    Then private JSON media requests preserve exact bytes and canonical binding constraints

  Scenario: Native JSON media operations become available
    Then all 16 JSON media operations preserve native identity and declared schemas
