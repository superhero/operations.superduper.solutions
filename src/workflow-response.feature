# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-response
Feature: Workflow response header decoding
  Declared response headers are decoded with their schema, while unavailable metadata remains raw.

  Scenario: Response headers preserve strings and decode null enum and constant values
    Then response headers preserve strings and decode null enum and constant values

  Scenario: Simple header objects validate names required properties and flat property types
    Then simple header objects validate names required properties and flat property types

  Scenario: Response header references fail safely when cyclic malformed external or absent
    Then response header references fail safely when cyclic malformed external or absent

  Scenario: Header decoding uses response ranges and defaults while undeclared metadata stays raw
    Then header decoding uses response ranges and defaults while undeclared metadata stays raw
