# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Explicit request field presence
  Scenario: Edit optional and nullable fields without losing their values
    Then request field controls preserve drafts and send distinct omitted null and literal values

  Scenario Outline: An optional nullable body can be absent or JSON null
    Then an OpenAPI "<version>" optional body sends omission and null distinctly

    Examples:
      | version |
      | 3.0.3   |
      | 3.1.0   |

  Scenario: Connected null values cannot be overridden by field controls
    Then a connected nullable input stays locked and sends the upstream null
