# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@tenant-readiness
Feature: Tenant configuration is required for execution rather than insertion
  Scenario: Every affected tenant operation keeps its execution requirement
    Then all 316 native tenant operations allow insertion and retain their run guards

  Scenario: Unsafe destinations and other capability failures still prevent insertion
    Then tenant readiness distinguishes valid unconfigured routes from invalid contracts

  Scenario: Unconfigured operations can be added through assistant edits without granting execution
    Then an unconfigured tenant graph persists its requirements and rejects all dispatch

  Scenario: The Assets token path retains its private result contract and source evidence
    Then the Assets import source parameter correction is scoped and preserves private adoption
