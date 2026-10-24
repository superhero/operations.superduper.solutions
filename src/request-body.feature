# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@primitive-array-forms
Feature: Repeated primitive form fields
  Scenario Outline: Repeated primitive forms preserve <media> through both HTTP executors
    Then repeated primitive fields preserve "<media>" values and file parts through both HTTP executors
    Examples:
      | media                            |
      | application/x-www-form-urlencoded |
      | multipart/form-data              |

  Scenario: Unsupported form structures and invalid array items cannot dispatch
    Then form arrays retain item constraints and reject unqualified structures before dispatch
