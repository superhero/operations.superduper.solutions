# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Recorded metric series
  Observations retain their units and identity without inventing unavailable values.

  Scenario: Browser, heap, and application memory observations retain real zeroes
    Then metric observations retain valid byte, ratio, category, and processing values

  Scenario: Missing or invalid measurements do not become zero-valued history
    Then unavailable and invalid metric observations remain absent

  Scenario: Dots in database and store names cannot overwrite another counter
    Then metric observations keep dotted database and store names distinct

  Scenario: Historical and live series have readable labels and matching units
    Then metric series combine history and live observations with readable units

  Scenario: Related measurements share a tree without changing their metric identities
    Then metric tree paths group resources and preserve encoded entity names

  Scenario: Derived storage utilization remains available on the dashboard without repeating the usage chart
    Then storage utilization stays in the dashboard report without becoming a history choice

  Scenario: A storage component identical to total usage shares its chart choice without losing recorded samples
    Then storage breakdowns matching total usage throughout history share its chart choice

  Scenario: Independent resources and distinct or missing storage observations are not mistaken for duplicates
    Then distinct or incompletely observed storage breakdowns keep their own chart choices

  Scenario: Retired counters are hidden while supported measurements can recover from unavailability
    Then retired metric keys disappear without erasing supported unavailable history

  Scenario: Confirmed deletions remove database, store, and repository choices without rewriting history
    Then complete inventories remove deleted entities while preserving encoded metric identities

  Scenario: Incomplete or failed inventories cannot establish that an entity was deleted
    Then incomplete or failed inventories preserve entity history

  Scenario: A known entity remains selectable while its contents are temporarily unreadable
    Then temporarily unreadable databases and repositories retain their metric history

  Scenario: Structural inventory remains outside recorded resource usage and historical chart choices
    Then structural inventory values are neither recorded nor selectable as resource history
