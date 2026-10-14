# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@workflow-curve
Feature: Workflow connection curve geometry

  Scenario: Curves follow every port orientation with centered labels
    Then workflow curves follow every port orientation and keep their label at the cubic midpoint

  Scenario: Curve strength controls backward connection bends
    Then backward workflow connections bow out farther with increased curve strength
