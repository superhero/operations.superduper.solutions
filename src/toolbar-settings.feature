# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Toolbar visibility preferences
  Scenario: New and malformed preferences show every control
    Then toolbar preferences default to visible and normalize only known boolean choices
