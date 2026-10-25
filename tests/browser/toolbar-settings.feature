# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Toolbar button visibility
  Scenario: Every toolbar button can be hidden and restored
    Given nested workflow input and output branches mapped to another operation
    Then toolbar visibility choices persist and leave keyboard shortcuts available
  Scenario: Application settings balance cards at the available pane width
    Given nested workflow input and output branches mapped to another operation
    Then application preferences adapt and balance cards as the pane is resized
