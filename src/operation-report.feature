# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Read source operation reports locally

  Scenario: Both example catalogs retain source metadata and their catalog group paths
    Then every bundled example has an independent source report and described group path

  Scenario: Mock and live examples have distinct source routes and keep saved demo identities
    Then the example registries separate mocked endpoints from live HTTPBin endpoints

  Scenario: A scoped report preserves the selected endpoint and its shared context
    Then operation schema reports preserve metadata and inherited parameters without unrelated operations

  Scenario: Effective endpoint and authentication metadata respects operation overrides
    Then schema reports use effective servers and only required security schemes

  Scenario: Local reference closures retain escaped pointers and recursive definitions
    Then schema reports preserve transitive escaped and cyclic references at their original pointers

  Scenario: Literal examples and payload keys are not mistaken for references
    Then schema traversal distinguishes real definitions from literal example and extension data

  Scenario: Unresolved references remain visible with truthful warnings
    Then unresolved schema references warn without fetching or expanding other operations

  Scenario: Links stay within the selected operation scope
    Then operation links preserve local context and warn about external or other operation targets

  Scenario: Missing source operations do not produce invented reports
    Then unavailable operation schemas fail with a useful reason
