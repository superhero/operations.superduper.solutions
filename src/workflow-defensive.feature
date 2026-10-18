# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@source
Feature: Defensive workflow and routing behavior

  Scenario: Write-only array items remain absent from response output fields
    Then an output array with write-only items retains an empty array panel

  Scenario: Imported output panels do not require generated owner-prefixed IDs
    Then renaming a response body panel preserves downstream response mapping

  Scenario: Unrecognized response metadata does not alter response status selection
    Then an unrelated nonconnectable output field does not change a successful response

  Scenario: Disconnected vault variables do not require a selected secret
    Then an unused unselected vault variable does not block an ordinary workflow

  Scenario: Routing type inference tolerates an unavailable mapping source
    Then an unavailable switch mapping source retains the unknown routing type

  Scenario: Rounded paths retain a valid single-point preview
    Then rounding a single-point route falls back to its move command

  Scenario: Disjoint collinear routes do not attract a connection
    Then a far collinear route does not change the chosen connection path
