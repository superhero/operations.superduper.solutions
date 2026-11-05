# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Compact offline schema transport
  Scenario: Every shipped schema and discovery pack retains its exact bytes
    Then compact schema encoding roundtrips every bundled gzip file and partial byte group

  Scenario: Invalid compact frames cannot become schema bytes
    Then compact schema decoding rejects invalid lengths characters and overflowing groups

  Scenario: Compact transport preserves canonical document integrity
    Then compact schema documents retain the same length hash and JSON checks

  Scenario: Only inline bundled schema assets use compact transport
    Then the compact schema build plugin leaves other assets alone
