# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-files @binary-files
Feature: Binary workflow files
  Scenario: Original bytes survive storage without text decoding
    Then binary uploads retain exact bytes and validate persisted file envelopes
  Scenario: File inputs follow the declared OpenAPI transport
    Then raw and multipart file schemas accept files without enabling unsupported transports
  Scenario: JSON attachments and query annotations retain text transport
    Then file annotations outside raw and multipart bodies preserve service JSON and query strings
  Scenario: One file connector supplies parsed data and original bytes
    Then file connections infer binary or parsed output from their destination
  Scenario: Binary casts are visible editable and reusable
    Then binary casts encode text and JSON and automatic file casts remain ordinary workflow nodes
  Scenario: Anonymous and authenticated HTTP requests preserve file bytes
    Then both HTTP executors send exact raw and multipart file bodies
