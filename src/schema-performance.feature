# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-performance
Feature: Measured schema processing
  Performance evidence retains the complete catalogue and the established matching contract.

  Scenario: Profile the full catalogue with exact matching equivalence
    Then the complete service catalogue is profiled with unchanged matching results

  Scenario: Exact matching preserves Unicode and common-affix behavior
    Then indexed matching retains exact scores for varied Unicode names and queries

  Scenario: Bounded matching preserves threshold boundaries and the exact top five
    Then compact edit budgets preserve full-ranking results across ties and long names
