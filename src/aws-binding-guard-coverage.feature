# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: AWS native binding and route guards
  Scenario: AWS REST native normalization preserves composed inputs and provenance
    Then AWS REST native normalization retains schema alternatives and migrates required body fields

  Scenario: AWS XML metadata maps retain their header location
    Then AWS XML metadata maps migrate out of bodies without retaining spurious required fields

  Scenario: AWS Outposts routes retain account and resource authority
    Then AWS Outposts routes reject conflicting resources malformed paths and destination suffixes
