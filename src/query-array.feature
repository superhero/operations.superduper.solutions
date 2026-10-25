# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@query-array
Feature: Comma-separated primitive query arrays
  Scenario: Structural delimiters and encoded item delimiters remain distinct
    Then comma-separated query members round trip reserved characters Unicode and empty strings

  Scenario: Omitted empty and nullable values have explicit wire semantics
    Then comma-separated arrays omit optional empty lists and reject required empty or explicit null values

  Scenario: Unsupported item shapes and serialization profiles remain unavailable
    Then comma-separated query models reject nested nullable binary reserved and custom serialization

  Scenario: Existing query forms retain their wire behavior
    Then scalar repeated-array and deep-object queries retain their exact encoding

  Scenario: Private query credentials cannot normalize comma separators
    Then private array requests retain exact delimiters and privately injected query keys

  Scenario: Canonical approval binds the selected array encoding
    Then changed or forged array serialization cannot reuse private approval or workflow fields

  Scenario: The pinned GitLab checkpoints array prepares its native request
    Then native GitLab checkpoints preserve source identity and prepare channel arrays
