# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reversible six-color palettes
  Scenario: Light and dark modes reverse the same ordered palette
    Then every ordinary theme color reverses its position in the six-color palette
    And prompt fields and badges remain readable while primary actions use the label foreground in both modes

  Scenario: A replacement palette needs only six new colors
    When I replace only the six ordered palette colors
    Then every ordinary theme color reverses its position in the six-color palette
    And prompt fields and badges remain readable while primary actions use the label foreground in both modes

  Scenario Outline: Settings preserves <palette> at <width> pixels independently of light and dark mode
    Given I use a viewport of <width> by 844 pixels
    When I switch to the settings workspace
    Then Settings offers all palettes with "Default" selected
    When I select the "<palette>" palette with the keyboard
    Then "<palette>" and theme preferences persist independently after reloading
    And every ordinary theme color reverses its position in the six-color palette
    And the page fits the viewport horizontally

    Examples:
      | width | palette       |
      | 1280  | Sunset        |
      | 390   | Sunset        |
      | 1280  | Alpine        |
      | 390   | Alpine        |
      | 1280  | Obsidian      |
      | 390   | Obsidian      |
      | 1280  | Midnight Gold |
      | 390   | Midnight Gold |
      | 1280  | Neon          |
      | 390   | Neon          |
      | 1280  | Lantern       |
      | 390   | Lantern       |
      | 1280  | Spring        |
      | 390   | Spring        |
      | 1280  | Bonfire       |
      | 390   | Bonfire       |
      | 1280  | Harvest Moon  |
      | 390   | Harvest Moon  |
      | 1280  | Blue Horizon  |
      | 390   | Blue Horizon  |
      | 1280  | Golden Violet |
      | 390   | Golden Violet |
      | 1280  | Citrus        |
      | 390   | Citrus        |
      | 1280  | Cappuccino    |
      | 390   | Cappuccino    |
      | 1280  | Garden Dusk   |
      | 390   | Garden Dusk   |
      | 1280  | Autumn        |
      | 390   | Autumn        |
      | 1280  | Rainfall      |
      | 390   | Rainfall      |
      | 1280  | Graphite       |
      | 390   | Graphite       |
      | 1280  | Steel          |
      | 390   | Steel          |
      | 1280  | Carbon         |
      | 390   | Carbon         |
      | 1280  | Heritage Noir  |
      | 390   | Heritage Noir  |

  Scenario Outline: Invalid or unavailable palette preferences retain a usable Default palette
    When I reload with an "<preference>" palette preference
    And I switch to the settings workspace
    Then Settings offers all palettes with "Default" selected
    And all palettes remain usable in both theme modes

    Examples:
      | preference  |
      | unknown     |
      | unavailable |
