# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-queries
Feature: Scoped private native metadata queries
  A separate operator opt-in permits finite metadata reads inside the paired workspace.

  Scenario: Metadata queries preserve their complete native results and page inputs
    Then all reviewed metadata queries run through encrypted pairing and exact method scopes

  Scenario: Metadata queries require the operator opt-in and cannot borrow agent scope
    Then native metadata tickets reject missing opt-in and methods outside their selected scope

  Scenario: Metadata parameters reject overrides and resolve only authorized workspace directories
    Then native metadata inputs and canonical directories reject overrides escapes and private homes

  Scenario: Metadata result unions remain strict and unknown fields cannot escape
    Then native metadata results validate nested variants required fields and private credential echoes

  Scenario: Stale sources cancellation and changed runtime authority withhold metadata
    Then native metadata cancellation and stale authority stop their owned pending query

  Scenario: Metadata workflow models preserve portable typed native output ports
    Then native metadata models expose native inputs and concrete result fields without HTTP adaptation

  Scenario: App queries require separate authority and standalone input contracts
    Then app metadata needs its own host opt-in and rejects loaded thread inputs

  Scenario: App results preserve public structured metadata and reject private tool schemas
    Then app metadata validates structured display fields and withholds unknown or private values

  Scenario: App inventory updates and interactions cannot acquire execution authority
    Then app queries discard update notifications deny server interactions and never replay cancelled refreshes
