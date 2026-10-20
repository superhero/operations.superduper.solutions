# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@operation-navigation
Feature: Operation resources and API versions
  Navigation follows literal URL resources while workflows retain concrete contracts.

  Scenario: Resource categories omit versions and path parameters without changing endpoint identity
    Then URL resource categories preserve templates queries and non-version resource names

  Scenario: Resource trees retain authored headings and every concrete operation
    Then operation resource groups are stable nested trees without mutating their sources

  Scenario: Version families share a menu action while search can choose a concrete version
    Then version families stay scoped to schema method and endpoint and respect availability and search

  Scenario: Changing API version replaces the contract and retains compatible workflow mappings
    Then switching a canonical operation version preserves identities and discards obsolete mappings

  Scenario: Changing versions respects closed data branches and legacy workflow control links
    Then version replacements preserve hidden branches control links and legacy operation nodes
