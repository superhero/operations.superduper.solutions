# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-documents
Feature: Schema document import and validation
  Imported schemas retain their complete document while rejecting unsafe or unsupported definitions.

  Scenario: JSON and YAML imports retain complete documents and support bounded aliases
    Then JSON and YAML imports retain complete documents and support bounded aliases

  Scenario: Malformed, ambiguous and non-JSON YAML content fails before extraction
    Then malformed, ambiguous and non-JSON YAML content fails before extraction

  Scenario: Expanded documents reject excessive nesting, bytes, incompatible objects, and ambiguous mapping keys
    Then expanded documents reject excessive nesting, bytes, incompatible objects, and ambiguous mapping keys

  Scenario: Parser failures retain non-Error causes with the uploaded filename
    Then parser failures retain non-Error causes with the uploaded filename

  Scenario: Imports use opaque identities and title collisions do not merge operation namespaces
    Then imports use opaque identities and title collisions do not merge operation namespaces

  Scenario: Required metadata and invalid operation definitions have invalid-document diagnostics
    Then required metadata and invalid operation definitions have invalid-document diagnostics

  Scenario: Valid OpenAPI features outside the executable subset say unsupported
    Then valid OpenAPI features outside the executable subset say unsupported

  Scenario: Tag groups are namespaced, preserve descriptions and include untagged operations
    Then tag groups are namespaced, preserve descriptions and include untagged operations

  Scenario: Effective servers retain base paths, resolve defaults and follow operation/path precedence
    Then effective servers retain base paths, resolve defaults and follow operation and path precedence

  Scenario: Local Path Item references retain inherited parameters and server overrides
    Then local Path Item references retain inherited parameters and server overrides

  Scenario: Path and response references reject unsafe targets without silently dropping sibling fields
    Then path and response references reject unsafe targets without silently dropping sibling fields

  Scenario: Server definitions require valid URL strings and usable variable defaults
    Then server definitions require valid URL strings and usable variable defaults

  Scenario: Vendor extensions and empty webhooks remain metadata while executable webhooks and Swagger are rejected
    Then vendor extensions and empty webhooks remain metadata while executable webhooks and Swagger are rejected

  Scenario: Unsafe paths and unusable servers are rejected instead of routing to the application origin
    Then unsafe paths and unusable servers are rejected instead of routing to the application origin

  Scenario: Both bundled schemas remain valid with their durable operation identifiers
    Then both bundled schemas remain valid with their durable operation identifiers
