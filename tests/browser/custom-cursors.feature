# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@custom-cursors
Feature: Optional custom cursors preserve interaction feedback
  Scenario: Custom cursors default on and the immediate opt-out survives reloading
    Then custom cursors default on with embedded artwork and exact native fallbacks
    And turning custom cursors off preserves native text behavior and unrelated styles
    And the cursor preference survives reloading in both states

  Scenario: Cursor artwork follows light dark and palette changes
    Then cursor artwork follows the current foreground and background in both theme modes

  @cursor-surfaces
  Scenario Outline: Empty navigation and page surfaces use the custom arrow at <width> pixels
    Given I use a viewport of <width> by 900 pixels
    Then hovering empty navigation and page space follows the cursor preference without changing controls or text

    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario Outline: Startup reconciles a <cache> cursor cache with a <stored> database value
    Given I reload with a "<cache>" cursor cache and a "<stored>" database value
    Then the first cursor preference is "<first>" and the confirmed preference is "<confirmed>"

    Examples:
      | cache  | stored  | first | confirmed |
      | legacy | false   | true  | false     |
      | false  | true    | false | true      |
      | false  | missing | false | true      |
      | false  | invalid | false | true      |

  Scenario: Failed cursor writes remain usable and retry saves the latest choice
    Then a failed cursor save keeps the confirmed cache and retries the latest choice

  Scenario: A delayed settings retry cannot replace a newer cursor choice
    Then a cursor edit made during a delayed settings retry remains authoritative

  Scenario: Eligible locked and structural ports keep their distinct cursor states
    Given a workflow with an occupied data field and separate free fields
    Then custom and native port cursors preserve connection eligibility and disabled exceptions

  Scenario: Both segment axes retain their resize cursors
    Given an imported manual routing workflow at zoom 1
    Then custom and native segment cursors match their allowed movement axes

  Scenario: Panning and node dragging retain feedback when custom cursors change
    Given an occupied cast workflow input
    Then canvas node and minimap dragging keep their cursor states through an immediate opt-out

  Scenario Outline: Embedded cursor artwork and native fallback work in <browser>
    Then "<browser>" renders and disables cursor artwork at density <density> and CSS zoom <zoom>

    Examples:
      | browser | density | zoom |
      | Firefox | 1       | 1.25 |
      | WebKit  | 2       | 0.8  |
