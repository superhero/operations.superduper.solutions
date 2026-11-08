# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Native plugin certificate sidecars stay in their owned temporary root
  Scenario: Plugin TLS signing remains contained beneath a dotted runtime directory
    Then actual plugin TLS signing verifies HTTPS and cleans its owned serial beneath a dotted runtime directory
