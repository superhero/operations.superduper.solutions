# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Default service operation catalogs
  Scenario: Every packaged HTTP operation remains represented
    Then the default service index retains every packaged operation and reports execution limits

  Scenario: Standard inputs and advanced JSON remain usable without altering the source
    Then service inputs preserve standard validation and explicitly use server validation for complex JSON

  Scenario: OAuth tokens retain the declared scope boundary
    Then service OAuth tokens use bearer credentials with scope-bound operation fingerprints

  Scenario: Invalid contracts fail clearly and advanced constraints retain JSON input
    Then service contract guards reject invalid operations without dropping their source

  Scenario: Local references defaults and empty form definitions remain usable
    Then service reference defaults and form guards preserve their declared behavior

  Scenario: Generic JSON inputs cannot accidentally stringify structured URL values
    Then service request preparation rejects unsupported structured parameter values
