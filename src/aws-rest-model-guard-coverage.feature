# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS REST typed model guards
  Scenario: AWS REST JSON codecs retain typed aliases and bounded containers
    Then isolated AWS REST JSON models preserve typed values and reject malformed containers

  Scenario: AWS REST XML writers retain typed maps attributes and namespaces
    Then isolated AWS REST XML models preserve maps attributes namespaces and payload wrappers

  Scenario: AWS REST XML event models retain typed payloads and explicit completion
    Then isolated AWS REST XML events preserve wrapped and direct values and reject exception frames
