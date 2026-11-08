# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@scalar-query
Feature: Scalar form query parameters
  Scenario: Boolean explode modes preserve each primitive query value
    Then scalar query values use identical typed and escaped requests in both explode modes

  Scenario: Other parameter representations retain their guards
    Then scalar query support rejects malformed flags and unrelated serialization modes

  Scenario: An organization identifier may also be the literal null string
    Then referenced pattern and enum string alternatives retain their exact validation

  Scenario: Unrepresentable unions retain their source constraints
    Then scalar query normalization preserves ambiguous or unsupported string unions

  Scenario: Native scalar query operations all become available
    Then all fifty reviewed scalar query operations preserve source identity and become available

  Scenario: Scalar wire support preserves private authorization
    Then private scalar queries retain exact values without exposing or replacing credentials
