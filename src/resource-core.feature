# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Resource collection foundations
  Worker accounting, startup reporting, and resource identities remain accurate and isolated.

  Scenario: Worker accounting distinguishes page contexts and releases workers idempotently
    Then worker accounting distinguishes page contexts and releases workers idempotently

  Scenario: Startup reporters can be registered replaced and detached without retaining callbacks
    Then startup reporters can be registered replaced and detached without retaining callbacks

  Scenario: Storage namespaces separate schema catalogs workflow repositories settings and metrics
    Then storage namespaces separate schema catalogs workflow repositories settings and metrics

  Scenario: Additional body fields handle open objects missing property maps and invalid type declarations
    Then additional body fields handle open objects missing property maps and invalid type declarations

  Scenario: Operation reports reject cyclic external malformed and missing path item references
    Then operation reports reject cyclic external malformed and missing path item references

  Scenario: Unavailable repositories and malformed encoded history keys cannot invent resource counters
    Then unavailable repositories and malformed encoded history keys cannot invent resource counters
