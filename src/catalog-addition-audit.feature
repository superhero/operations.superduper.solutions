# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Bounded catalog addition audit
  Scenario: Exact operation selections reject typos and keep isolated identities
    Then the catalog audit selects exact operation identifiers without hiding unknown selections

  Scenario: Every attempt starts with a distinct empty workflow
    Then the catalog audit deletes each workflow before attempting the next operation

  Scenario: Application failures remain failures and do not hide later operations
    Then the catalog audit retains insertion errors while completing the remaining inventory

  Scenario: A failed cleanup cannot accumulate workflows
    Then the catalog audit discards a dirty context or stops before the next addition

  Scenario: Reused workflow identities are rejected
    Then the catalog audit refuses to reuse a previous workflow identity

  Scenario: Prepared fixtures retain exact bytes and reject stale or damaged inputs
    Then prepared catalog fixtures preserve binary assets and reject changed sources or contents
