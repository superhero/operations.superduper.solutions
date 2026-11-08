# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Declared multipart part encodings
  Scenario: JSON metadata and SDP text retain their declared part types
    Then both multipart parsers send typed JSON and SDP parts through public and private HTTP execution

  Scenario: Filename parts and nested bundles preserve exact bytes
    Then multipart filename collections and nested bundles preserve names boundaries and file bytes

  Scenario: Unsupported part contracts fail with the offending field
    Then malformed multipart encodings and incompatible values cannot dispatch

  Scenario: Native multipart corrections preserve all upstream representations
    Then the eight multipart body corrections retain native identities source bodies and alternate media

  Scenario: All reviewed native multipart parts execute with their authentication
    Then all eight reviewed multipart operations send their declared part types and private authorization

  Scenario: Multipart encoding changes invalidate private authority
    Then changed multipart part media cannot reuse an approved credential binding

  Scenario: Read-only multipart properties remain outside editable inputs
    Then both multipart parsers omit read-only body properties without changing the source contract
