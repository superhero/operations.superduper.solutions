# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@trello-parameter-arrays
Feature: Trello primitive parameter arrays
  Scenario: Native Trello arrays preserve enum and identifier constraints
    Then the three native Trello array operations prepare exact validated requests

  Scenario: Trello source corrections are scoped and reject drift
    Then Trello array corrections preserve native evidence and reject changed contracts

  Scenario: Trello arrays execute through private credential injection
    Then a Trello bulk request keeps credentials private and rejects invalid identifiers before fetch
