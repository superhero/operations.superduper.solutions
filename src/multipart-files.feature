# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Repeated multipart files
  Scenario: File collections preserve multipart order and bytes
    Then both parsers send repeated multipart files with their names types bytes and ordinary fields

  Scenario: File collections retain schema and transport guards
    Then multipart file arrays reject nullable nested mixed and corrupt files while preserving bounds

  Scenario: Provider form corrections retain their sources
    Then multipart provider corrections preserve native provenance and reject drift

  Scenario: All ten native file collection operations have real wire support
    Then all ten native file collection operations prepare authenticated multipart requests
