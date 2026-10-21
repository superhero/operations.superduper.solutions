# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Safe workflow comment previews
  Comments use markdown-it and mdit plugins with image sizing and lazy loading.

  Scenario: Common block and inline formatting retains comment content
    Then workflow comment previews support headings paragraphs lists quotes and code
    And workflow comment previews support emphasis code and safe links

  Scenario: Markdown images render while untrusted markup and unsafe destinations stay blocked
    Then workflow comment previews render Markdown images while rejecting raw HTML and unsafe links

  Scenario: Incomplete Markdown and line endings preserve readable annotations
    Then workflow comment previews retain incomplete formatting and normalize line endings

  Scenario: Markdown extensions share safe rendering across comment surfaces
    Then workflow comments render mdit extensions with independent safe identifiers

  Scenario: Comment sizes are bounded and survive document round trips
    Then comment dimensions persist and reject invalid sizes
