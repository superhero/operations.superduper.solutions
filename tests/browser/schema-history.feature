# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-history
Feature: Schema commit comparisons and correction review
  Schema settings show source ancestry, corrections and merge decisions without eager document loading.

  Scenario: Commit comparisons and colored field diffs preserve conflict review and mobile scrolling
    Then schema history compares any saved commits with lazy colored diffs and persistent conflict choices
