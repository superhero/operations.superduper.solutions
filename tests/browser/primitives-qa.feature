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

  Scenario: Prompt matching details expose keyboard-accessible styled help
    Then prompt matching details preserve keyboard navigation

  Scenario: Nested schema actions keep their own help and disclosure state
    Given I open the "Example object response" operation from the catalog
    Then schema action hints take priority over the disclosure hint

  Scenario: Scrolling cancels help that has not opened yet
    Given I open the "Example POST body" operation from the catalog
    Then scrolling cancels a pending operation tooltip

  Scenario: Settings scroll independently of a stationary main header
    Given I switch to the settings workspace
    Then settings scroll independently of the main header
