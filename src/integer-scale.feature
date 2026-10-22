# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Integer slider scales
  Integer controls retain their schema bounds while offering fine logarithmic adjustments.

  Scenario: Unbounded integers retain their signed safe domain
    Then logarithmic integer scales preserve zero negatives and exact safe endpoints

  Scenario: Explicit maximum bounds concentrate value changes around the middle
    Then bounded integer scales are symmetric around their midpoint and monotonic

  Scenario: Bounded logarithmic controls retain zero and precision across orders of magnitude
    Then logarithmic integer scales span zero through one thousand with fine low-value adjustments

  Scenario: Schema bounds describe only their valid safe integers
    Then integer scales round bounds inward and handle fixed empty and nonfinite ranges

  Scenario: Integer values and slider positions remain consistent
    Then integer scale conversions round trip within floating point precision
