# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Compact bounded Twilio request fields
  Scenario Outline: Select and send the last explicit pair on <kind> at <width> pixels
    When I use a viewport of <width> by 844 pixels
    Then the saved "<kind>" form selects its last optional pair without rendering every field
    Examples:
      | kind         | width |
      | CreateStream | 1280  |
      | CreateSiprec | 390   |
