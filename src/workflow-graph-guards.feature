# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-graph-guards
Feature: Imported workflow schemas retain safe editing boundaries

  Scenario: Response headers project unambiguous content representations
    Then workflow response headers project one documented content representation and keep ambiguous headers nonconnectable

  Scenario: Malformed additional-property constraints cannot authorize fields
    Then malformed workflow additional-property constraints cannot enable arbitrary fields

  Scenario: Imported panels require real owners and canonical identities
    Then imported workflow panels require a real owner and a canonical well-formed schema identity

  Scenario: Legacy output panels require available object responses
    Then legacy workflow output panels require an available response and a named object media representation

  Scenario: Stale child panels cannot authorize changes after schema updates
    Then stale imported workflow child panels cannot authorize changes through missing parents or changed schemas

  Scenario: Imported array panels respect item constraints and expansion limits
    Then imported workflow array panels reject unsupported item constraints and paths beyond the expansion limit
