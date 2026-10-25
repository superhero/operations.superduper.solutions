# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Explicit Atlassian server identities
  Scenario: Assets retains all native identities with required unconfigured server slots
    Then the Assets correction preserves its source and requires both server identities

  Scenario: Explicit settings resolve current and legacy Assets routes without changing their contracts
    Then configured Assets server variables retain exact HTTPS prefixes and legacy limitations

  Scenario Outline: Private Assets <kind> uses the configured site and workspace
    Then the configured Assets "<kind>" operation prepares its exact private destination
    Examples:
      | kind |
      | AQL  |
      | icon |

  Scenario: Missing or unsafe identities reject before URL normalization and dispatch
    Then Assets server slots reject missing placeholders and path fragments before private approval

  Scenario: Each configured tenant identity is bound to private approval
    Then changing either Assets server identity rejects the previous private binding

  Scenario: The JSM subscriber route uses its documented parent without a duplicated prefix
    Then the corrected JSM subscriber deletion retains native identity and exact private preparation

  Scenario: Corrections reject changed provider or template contracts
    Then Atlassian server recipes reject drift ambiguous variables and incorrect patch ordering

  Scenario: Compass and unrelated server templates remain unchanged
    Then Atlassian server qualification leaves Compass and unrelated URL rules intact
