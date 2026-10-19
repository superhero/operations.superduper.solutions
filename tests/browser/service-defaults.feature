# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Default service schemas in the application
  @service-defaults
  Scenario: Fresh profiles include the complete collection and retain local choices
    Then all service schemas appear and preserve disablement renames and deletions after reload

  Scenario: Existing profiles receive new defaults without losing authored documents
    Then the default schema migration preserves an existing custom document and disabled example
