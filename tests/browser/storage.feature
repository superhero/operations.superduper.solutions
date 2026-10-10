# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Read-only browser storage dashboard
  Scenario: Storage reports native browser usage and complete database structure without mutations
    Given a database containing indexed records and an empty store
    Then Storage shows native estimates and accurate database metadata without changing storage

  Scenario: Workflow storage metrics reflect real Git history and refresh after another saved version
    Given two independent Git workflows with saved versions
    Then Storage reports repository bytes and history without changing either workflow
    And refreshing Storage includes the next saved workflow version

  Scenario: Storage inspects dirty Git state without rewriting files and isolates repository failures
    Given two independent Git workflows with saved versions
    Then Storage accurately reports dirty Git files without rewriting the index
    And an unreadable repository does not hide another workflow's metrics

  Scenario: Storage distinguishes best-effort persistence and computes remaining capacity
    Given browser storage estimates are known and persistence is not granted
    Then Storage displays best-effort persistence and the calculated capacity

  Scenario: Missing storage APIs retain useful metrics without creating phantom databases
    Given browser storage estimate and enumeration APIs are unavailable
    Then Storage reports unavailable metrics and safely inspects existing application databases

  Scenario: Storage remains usable on narrow screens with long database and workflow names
    Given I use a viewport of 390 by 844 pixels
    And storage contains a database and workflow with long names
    Then expanded Storage details fit the narrow viewport
