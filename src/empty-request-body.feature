# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@empty-request-body
Feature: Optional request bodies without media declarations
  Scenario: Empty optional content prepares a bodyless request
    Then optional empty content has no body fields payload or content type in either importer

  Scenario: Required or malformed content retains an explicit limitation
    Then empty body support rejects required malformed and unsupported media declarations

  Scenario: The native Render cache purge preserves its route and source
    Then the native Render cache purge accepts its optional empty body unchanged

  Scenario: Private empty-body requests still require authorized credentials
    Then Render cache purge sends its private bearer request without a fabricated body

  Scenario: Empty untyped success responses differ from declared JSON
    Then empty untyped responses produce null while declared JSON remains strictly decoded
