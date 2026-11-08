# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-command-workflow
Feature: Actual command workflow qualification
  Scenario: Pinned SDK command controls and terminal workflow results
    Then the pinned SDK drives command resize stdin termination and terminal workflow results
  Scenario: Pinned SDK buffered terminal workflow consumers
    Then the pinned SDK releases buffered terminal workflow consumers only after real completion
