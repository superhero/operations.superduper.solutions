# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-processing
Feature: Workflow processing controls and execution
  Scenario Outline: Stop supports editing and restoration
    When I use a viewport of <width> by 900 pixels
    Then Stop can be added undone exported and restored with only an input

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario Outline: Stop follows the matched assertion outcome
    Then Stop connected to assertion Failure <outcome> the run without an error

    Examples:
      | outcome   |
      | ends      |
      | preserves |

  Scenario Outline: Independent processing nodes retain configuration history and restoration
    When I use a viewport of <width> by 900 pixels
    Then Transform Filter and Assert can be configured undone exported and restored

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario: A processing chain executes in one lazy worker and releases it at completion
    Then a file filter transform and assertion complete without an HTTP operation or leaked worker

  Scenario: Private assertion RPC exposes decisions without transformed values
    Then the real vault worker checks a private transformation without returning its value

  Scenario Outline: Assertion <output> connections preserve values and manual input
    Then an assertion with a <output> connection proceeds with its original value or manual input

    Examples:
      | output |
      | failure |
      | success |
