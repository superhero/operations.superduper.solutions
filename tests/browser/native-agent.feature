# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-runtime-ui @native-agent-ui @native-test-tls @service-defaults
Feature: Execute a native Codex workflow from its private runtime
  Background:
    Given I create a vault in the Secrets settings and save a synthetic credential

  Scenario Outline: Device login and a mapped native workflow use the production worker
    When I use a viewport of <width> by 900 pixels
    Then native runtime login and workflow approvals complete without HTTP adaptation
    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario: Browser login remains pending until completion and can be cancelled
    Then native browser login waits for confirmation and cancellation preserves its paired account
