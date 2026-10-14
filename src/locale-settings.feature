# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Locale settings
  Date and time preferences preserve formatting, timezone behavior, and graceful fallbacks.

  Scenario: Public date helpers load in Node and use the current normalized preferences
    Then public date helpers load in Node and use the current normalized preferences

  Scenario: Normalization restores defaults for invalid fields and keeps supported preferences
    Then normalization restores defaults for invalid fields and keeps supported preferences

  Scenario: System formatting preserves the browser's default date, clock, and zone
    Then system formatting preserves the browser's default date, clock, and zone

  Scenario: Fixed date patterns preserve their order, padding, and Gregorian year across locales
    Then fixed date patterns preserve their order, padding, and Gregorian year across locales

  Scenario: Instant dates roll forward and backward with their selected timezone
    Then instant dates roll forward and backward with their selected timezone

  Scenario: Clock choices retain seconds and render midnight and noon correctly
    Then clock choices retain seconds and render midnight and noon correctly

  Scenario: Named zones apply daylight-saving transitions to historical instants
    Then named zones apply daylight-saving transitions to historical instants

  Scenario: Calendar dates stay on their own day across zones, skipped days, and leap days
    Then calendar dates stay on their own day across zones, skipped days, and leap days

  Scenario: Malformed timestamps and calendar dates display a graceful placeholder
    Then malformed timestamps and calendar dates display a graceful placeholder

  Scenario: Timezone options include UTC, the system zone, and supported named zones
    Then timezone options include UTC, the system zone, and supported named zones
