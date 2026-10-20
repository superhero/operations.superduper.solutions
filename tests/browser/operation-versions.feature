# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@toolbar-controls
Feature: Resource navigation and concrete workflow API versions
  Scenario Outline: Version choices load the selected contract and survive workflow history and portability
    When I use a viewport of <width> by 844 pixels
    Then nested resources expose one version family and the workflow executes the selected version

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario: Deleting a node while another API version loads prevents a late replacement
    Then a pending API version cannot restore a deleted operation

  @service-defaults
  Scenario: Anthropic resource navigation omits API versions and path parameters
    Then Anthropic operations follow their nested resources without altering their contracts
