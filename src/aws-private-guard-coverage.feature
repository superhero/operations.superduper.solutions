# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS private output model boundaries
  Scenario: AWS JSON private results retain typed bounded credential adoption
    Then isolated AWS JSON private outputs reject malformed models values and adopted references

  Scenario: AWS Query private results retain typed bounded credential adoption
    Then isolated AWS Query private outputs reject malformed models values and adopted references
