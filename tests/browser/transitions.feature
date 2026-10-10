# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reference motion and interruption behavior
  Scenario: Focus and hover feedback remain continuous and respect reduced motion
    Then prompt focus and navigation hover animate and settle with the motion preference

  Scenario: Closing and reopening a schema retains its visible content
    Given I open the "Create task" operation from the catalog
    Then report and schema transitions retain content through interruption

  Scenario: Native scrollbar feedback preserves scrolling and responds to reduced motion
    Then native scrollbars expand on hover and settle without changing the reading position

  Scenario: Hovering the prompt arrow cannot change which examples fit or toggle page overflow
    Then prompt examples and page overflow remain stable when resizing under a hovered arrow
