# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Toolbar visibility preferences
  Scenario: New and malformed preferences use the minimal toolbar
    Then toolbar preferences use minimal defaults and normalize only known boolean choices
