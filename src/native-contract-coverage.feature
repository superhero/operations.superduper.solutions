# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Native public contract boundaries
  Scenario: Guardian action conversion preserves observed permissions and paths
    Then Guardian review events preserve exact action aliases and filesystem permission entries

  Scenario: Guardian lifecycle validation rejects mismatched action and path variants
    Then Guardian lifecycle validation requires complete bounded action and permission variants

  Scenario: Schema choices preserve the bounded JSON input depth
    Then native input alternatives do not consume the JSON nesting budget or allow recursive schemas

  Scenario: Gateway sign-in metadata cannot introduce unsafe URLs or private fields
    Then gateway sign-in URLs and public states enforce their complete shape

  Scenario: Command transport rejects malformed parameters and foreign output
    Then native command contracts enforce bounded plain data and correlated notifications

  Scenario: Unknown native methods cannot acquire typed input or result contracts
    Then native contract entry points reject unknown methods and non-object parameters

  Scenario: Public configuration projection rejects malformed declarations and layers
    Then native configuration reads retain field bounds and reject malformed public projections

  Scenario: Configuration edits and fingerprints stay within their declared budgets
    Then native configuration writes and controls reject invalid edits oversized envelopes and unsafe fingerprint data

  Scenario: Workflow dispatch retains specialized native parameter contracts
    Then native workflow dispatch preserves plugin marketplace readiness and thread control contracts

  Scenario: Plugin selectors and collections retain their declared bounds
    Then plugin and marketplace parameters reject malformed selectors and oversized collections

  Scenario: Opaque native JSON retains finite shape depth and Unicode limits
    Then native JSON metadata thread and MCP contracts reject oversized malformed and ambiguous values

  Scenario: Shared envelope budgets count serialized UTF-8 bytes and retain typed failures
    Then native JSON envelope budgets preserve exact boundaries fields and error constructors

  Scenario: MCP and watch parsers reject malformed collections and foreign protocols
    Then native MCP and watch parsers retain malformed collection and protocol boundaries

  Scenario: Turn and thread lifecycle bounds retain native identifiers remotes and byte limits
    Then native turn and thread lifecycle bounds retain UUID revision remote and byte semantics

  Scenario: Thread shell declarations and notifications retain exact ownership and bounds
    Then native thread shell declarations and items retain exact owned shapes and timeout bounds

  Scenario: Feedback filesystem and section inputs retain exact malformed value boundaries
    Then native feedback filesystem and section inputs retain named malformed value and byte limits

  Scenario: Prepared native operations retain specialized adapters and precise diagnostics
    Then prepared native operations preserve specialized parameter adapters and precise public diagnostics

  Scenario: Optional native metadata preserves omitted fields and explicit no-auth ownership
    Then native optional metadata preserves omitted layers no-auth targets legacy pairings and classified migration text

  Scenario: Native schema qualification and batch writes reject missing and non-data declarations
    Then native schema qualification and batch writes retain declaration and plain-data guards
