# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reviewed AWS contract guard boundaries
  Scenario: AWS checksums accept bounded byte containers and reject malformed keys
    Then AWS checksum containers retain exact bytes and reject unsupported bodies and customer keys

  Scenario: AWS protocol markers retain strict catalog and approval boundaries
    Then strict AWS Query and JSON catalogs reject changed markers metadata and approval destinations

  Scenario: AWS model helpers reject missing shapes and incompatible descriptors
    Then AWS public model helpers retain finite schemas and reject unreviewed shapes and descriptors

  Scenario: AWS compressed contract packs reject truncation and unknown revisions
    Then AWS contract decoders reject truncated bytes and mismatched pinned inventories
