# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Navigation and help primitives
  Scenario: Animated desktop navigation receives focus when opened
    Then navigation focus follows normal-motion opening and breakpoint changes

  Scenario: Nested disclosures remain contained during animation
    Then expanding a nested catalog item does not clip its parent

  Scenario: Keyboard and pointer help share one active tooltip
    Then hovering another control replaces keyboard help

  Scenario: Progress help explains unavailable steps without making them interactive
    Then progress hints and examples preserve navigation and disabled states

  Scenario: Nested schema actions keep their own help and disclosure state
    Given I open the "Get project" operation from the catalog
    Then schema action hints take priority over the disclosure hint

  Scenario: Scrolling cancels help that has not opened yet
    Given I open the "Create task" operation from the catalog
    Then scrolling cancels a pending operation tooltip

  Scenario: Header shadow strengthens over the first eighty pixels
    Given I open the "Create task" operation from the catalog
    Then the header shadow follows the reading position
