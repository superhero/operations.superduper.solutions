# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@metadata-query
Feature: Bounded metadata query dictionaries
  Scenario: Dictionary keys and values retain their declared constraints
    Then both importers preserve metadata bounds names and exact deepObject encoding

  Scenario: Invalid dictionaries fail against the metadata input
    Then metadata dictionaries reject excess pairs invalid names values and malformed constraints

  Scenario: Native OpenAI metadata filters become available
    Then both native OpenAI vault metadata filters retain their schemas and exact request values

  Scenario: Private filters validate before sending credentials
    Then private metadata filters enforce limits preserve credentials and reject stale constraints
