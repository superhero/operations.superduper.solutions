# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Incremental schema interaction
  Scenario: Search preparation retains unchanged schema indexes only
    Then search indexes follow immutable schema descriptors and release disabled schemas

  Scenario: Worker index deltas install atomically
    Then search index deltas cannot publish an incomplete or stale snapshot

  Scenario: Workflow models share bounded schema requests
    Then overlapping workflow loads share bounded schema batches and preserve requested order

  Scenario: Failed model batches remain retryable
    Then invalid failed and obsolete model batches cannot become cached operations

  Scenario: A real service schema edit avoids normalizing unrelated schemas
    Then incremental index preparation is measured against full normalization

  @schema-model-profile
  Scenario: Profile repeated canonical reference projections
    Then repeated canonical projections are measured in bounded schema batches
