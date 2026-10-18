# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Browser settings construction
  Scenario Outline: The Browser dashboard builds after a compact status is painted
    Then Browser settings show a compact building status before the dashboard with "<motion>" motion in "<theme>" theme
    Examples:
      | motion        | theme |
      | no-preference | light |
      | reduce        | light |
      | no-preference | dark  |
      | reduce        | dark  |

  Scenario: Closing Browser settings cancels pending construction
    Then closing Browser before construction leaves it unbuilt until reopened
