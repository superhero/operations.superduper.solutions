# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Bounded inline worker program packing
  Scenario: Packed worker factories retain the exact program and native lifecycle
    Then useful inline workers decode byte for byte inside the original Vite constructor

  Scenario: Invalid worker programs and unqualified wrappers are rejected
    Then inline worker packing bounds source sizes validates payloads and rejects compiler drift

  Scenario: Large schema workers retain exact programs with asynchronous inflation
    Then only bounded schema library workers use the asynchronous bootstrap without changing their factory

  Scenario: Adaptive transport reduces worker size without changing its program
    Then adaptive worker transport saves bytes while legacy programs and integrity checks remain valid
