# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Workflow connection type contracts
  @coverage-gaps
  Scenario: Opaque JSON ports preserve values without promising a concrete runtime type
    Then opaque JSON connections accept JSON values and require a cast before concrete routing
