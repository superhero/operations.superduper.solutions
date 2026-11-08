# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-control
Feature: Actual SDK configuration controls
  Scenario: Real runtime overrides and skill roots stay in the shared SDK child
    Then the pinned SDK applies feature and skill overrides in the paired session
  Scenario: Real MCP reload preserves the owned loaded thread and tool access
    Then the pinned SDK reloads MCP for the owned loaded thread without inference
