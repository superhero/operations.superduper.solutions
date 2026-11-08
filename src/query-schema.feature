# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@query-schema
Feature: Constrained query schemas
  Scenario: Unique primitive arrays retain exact form encoding and constraints
    Then unique query arrays preserve values enums bounds omission and duplicate rejection

  Scenario: JSON uniqueness compares values rather than object member order
    Then unique input arrays distinguish JSON types and reject structurally equal members

  Scenario: Disjoint string alternatives retain exclusive validation
    Then disjoint query string alternatives accept identifiers or literals while overlapping unions remain guarded

  Scenario: All reviewed native query schemas become available
    Then all 79 query schema operations preserve their source and canonical constraints

  Scenario: Private execution validates uniqueness before sending credentials
    Then private unique queries reject duplicates and stale constraints before dispatch
