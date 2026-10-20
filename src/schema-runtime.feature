# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-runtime
Feature: Registered schemas at runtime
  Catalog changes remain consistent across reports, workflow runners and HTTP execution.

  Scenario: Schema names form nested navigation groups without changing operation categories
    Then slash-separated schema names form ordered groups without changing their sources

  Scenario: Schemas can share a name or serve as the parent of another schema
    Then schema name groups retain prefix schemas and duplicate labels independently

  Scenario: Renaming and reordering schemas rebuilds their navigation hierarchy
    Then schema name grouping follows current labels and order without retaining removed groups

  Scenario: Schema validation normalizes a non-Error failure from operation extraction
    Then schema validation normalizes a non-Error failure from operation extraction

  Scenario: HTTP execution retains server base paths and resolves operation and path server overrides
    Then HTTP execution retains server base paths and resolves operation and path server overrides

  Scenario: Request URLs reject host changes and traversal, retain encoded path values, and omit undefined queries
    Then request URLs reject host changes and traversal, retain encoded path values, and omit undefined queries

  Scenario: Unresolved server placeholders in cached models never reach HTTP execution
    Then cached server placeholders are rejected before fetching while configured and encoded URLs stay intact

  Scenario: Reports support generated identifiers and referenced path items without leaking other operations
    Then reports support generated identifiers and referenced path items without leaking other operations

  Scenario: Catalog changes immediately update reports, runners, and existing executors
    Then catalog changes immediately update reports, runners, and existing executors

  Scenario: Unchanged sources retain operation identity while source-only changes replace it
    Then unchanged sources retain operation identity while source-only changes replace it

  Scenario: Failed catalog replacements preserve both live indices
    Then failed catalog replacements preserve both live indices

  Scenario: Worker-prepared catalogs publish without reprocessing documents and retain unchanged operation identities
    Then worker-prepared catalogs publish without reprocessing documents and retain unchanged operation identities
