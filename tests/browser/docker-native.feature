# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@docker-native-ui @native-runtime-ui @native-test-tls @service-defaults
Feature: Paired Docker hosts in settings and workflows
  Background:
    Given I create a vault in the Secrets settings and save a synthetic credential

  Scenario Outline: A paired Docker host runs container listing through the production worker
    When I use a viewport of <width> by 900 pixels
    Then a Docker host pairs reloads and runs its scoped container listing
    Examples:
      | width |
      | 1280  |
      | 390   |

  Scenario: Daemon and source changes revoke the paired read
    Then Docker settings reject changed daemon and source authority before container reads
