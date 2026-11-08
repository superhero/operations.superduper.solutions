# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@atlassian-dc-authentication
Feature: Atlassian Data Center bearer permissions
  Scenario: Native OAuth2 references acquire their documented bearer transport
    Then all 699 reviewed Data Center operations retain source scopes alternatives and identity

  Scenario: Unsupported or changed exports require requalification
    Then Data Center authentication corrections reject source drift and permission overwrites

  Scenario: Existing Basic and undeclared authentication remain distinct
    Then Data Center authentication repairs preserve unaffected Basic and anonymous declarations

  Scenario: Preauthorized tokens remain private and bound to the configured instance
    Then Data Center bearer dispatch retains permissions credentials and destination approval

  Scenario: Shared security guards remain strict
    Then unqualified scoped bearer requirements and missing schemes remain rejected
