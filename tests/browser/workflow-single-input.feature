# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-single-input
Feature: An occupied workflow input accepts no additional incoming connection
  Scenario: Data inputs reject all connection gestures and unlock after disconnection
    Given a workflow with an occupied data field and separate free fields
    Then another source cannot connect by dragging clicking or dropping on the occupied field
    And removing its mapping unlocks the field while output fanout and schema-backed fields remain available

  Scenario Outline: Utility and legacy inputs lock only while their incoming connection exists
    Given an occupied <kind> workflow input
    Then its existing connection blocks another source until it is deleted

    Examples:
      | kind           |
      | cast           |
      | switch         |
      | switch operand |
      | legacy         |

  Scenario: Previously saved multiple incoming connections remain readable without permitting another
    Given a saved cast input with two existing incoming connections
    Then it stays locked until both old connections are removed and accepts a new source afterwards
