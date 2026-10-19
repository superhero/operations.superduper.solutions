# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-optimization
Feature: Bounded schema discovery and canonical models
  Compact discovery remains separate from authoritative workflow execution.

  Scenario: Source caching bounds retention and coalesces concurrent reads
    Then schema source caching retains recent values within its budget
    And failed and invalidated schema reads can be retried without stale cache publication

  Scenario: Discovery indexes preserve inventory and reject invalid cached data
    Then compact schema indexes preserve every operation without executable models
    And malformed or stale schema indexes are rejected

  Scenario: Deferred operations cannot execute before hydration
    Then only a current canonical model can enable a deferred operation

  Scenario: Model leases bound retention and preserve models used by open workflows
    Then workflow model pins retain active data and release obsolete models

  Scenario: Nested workflow hydration finds every operation once
    Then schema hydration collects legacy operations and nested workflow operations

  Scenario: Canonical models retain referenced operations outside the report view
    Then canonical schema slices preserve local references outside the selected operation

  Scenario: Bundled discovery and targeted models match the complete source collection
    Then every service discovery index matches its source and targeted operation models
