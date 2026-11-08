# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS native binding residual boundaries
  Scenario: JSON and Query bindings preserve optional native provenance
    Then JSON and Query native bindings preserve omitted declarations and reject missing target headers atomically

  Scenario: REST route corrections preserve prior declarations and remove unused paths
    Then REST native route corrections retain signer and body provenance while removing orphaned native paths

  Scenario: REST XML bindings preserve typed metadata and finite event schemas
    Then isolated REST XML native bindings retain aliases and reject incomplete body declarations
