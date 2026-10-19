# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Default service schemas in the application
  @service-defaults
  Scenario: Fresh profiles include the complete collection and retain local choices
    Then all service schemas appear and preserve disablement renames and deletions after reload

  Scenario: Existing profiles receive new defaults without losing authored documents
    Then the default schema migration preserves an existing custom document and disabled example

  @service-defaults @schema-profile @chromium-only
  Scenario: Measure schema startup search management and inspector retention
    Then schema lifecycle performance is measured with the complete service collection

  @service-defaults
  Scenario: Large schema inspection renders a bounded page and releases closed content
    Then the largest bundled schema can be inspected without retaining its closed viewer

  @service-defaults
  Scenario: Closing an inspector ignores an outstanding source response
    Then a closed schema inspector ignores a delayed source reply and can reopen

  @service-defaults
  Scenario: Long search menus keep native navigation and one active help popup
    Then full-library search renders nearby rows and shares tooltip state
