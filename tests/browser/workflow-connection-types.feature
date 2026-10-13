# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-connection-types
Feature: Workflow mappings respect the value types of their ports
  Background:
    Given a workflow with typed scalar fields and conversion utilities

  Scenario: Incompatible scalar types reject direct and snapped connection gestures
    Then incompatible scalar mappings show no valid preview and reject drag click and body drops

  Scenario: Matching scalar types and integer widening accept ordinary connections
    Then matching scalar fields and Integer to Number accept mappings with their original endpoints

  Scenario: Cast converts values while Switch preserves its incoming integer type
    Then a Cast accepts Text and exposes Number while a Switch keeps Integer on its output
