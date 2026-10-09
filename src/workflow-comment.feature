# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Safe workflow comment previews
  Comments render useful formatting as an escaped text tree without loading resources.

  Scenario: Common block and inline formatting retains comment content
    Then workflow comment previews support headings paragraphs lists quotes and code
    And workflow comment previews support emphasis code and safe links

  Scenario: Untrusted markup and unsafe destinations remain literal text
    Then workflow comment previews do not interpret raw HTML images or unsafe links

  Scenario: Incomplete Markdown and line endings preserve readable annotations
    Then workflow comment previews retain incomplete formatting and normalize line endings
