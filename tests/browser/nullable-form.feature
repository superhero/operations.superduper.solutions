# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@nullable-form-ui
Feature: Private nullable multipart files
  Background:
    Given I create a vault in the Secrets settings and save a synthetic credential

  Scenario Outline: Null is refused and a bounded file uploads through the real private worker
    When I use a viewport of <width> by 844 pixels
    Then a saved nullable file operation rejects null and uploads its exact file privately
    Examples:
      | width |
      | 1280  |
      | 390   |
