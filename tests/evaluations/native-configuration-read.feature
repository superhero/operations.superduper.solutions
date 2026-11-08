# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-read
Feature: Actual SDK configuration reads
  Scenario: Four configuration reads share one unauthenticated runtime session
    Then the pinned SDK reads configuration policy features and real skills without provider authentication
