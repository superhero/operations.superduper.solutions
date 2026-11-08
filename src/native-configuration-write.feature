# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-configuration-write
Feature: Verified configuration write contracts
  Scenario: Preference edits and skill selectors retain native semantics
    Then configuration write inputs preserve public preference types null removal and both selectors
  Scenario: Rejected edits identify their setting field and batch position
    Then configuration writes reject authority changes invalid values and ambiguous selectors by name
  Scenario: Configuration authority receipts belong to one exact write
    Then configuration transitions bind method request input result and unchanged runtime authority
  Scenario: Configuration write models retain graph and field contracts
    Then configuration write models preserve native results graph persistence and named JSON fields
  Scenario: Workflow reference continuation stays exact and bounded
    Then workflow references advance only through exact owned worker transitions and clear on revocation
