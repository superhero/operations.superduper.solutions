# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-history
Feature: Published schema branches and correction review
  Schema settings show source ancestry, corrections and merge decisions without eager document loading.

  Scenario: Corrected schema branches and conflicting updates stay inspectable across reloads
    Then schema settings display correction branches diffs and persistent field conflict choices
