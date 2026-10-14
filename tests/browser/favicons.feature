# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@favicons
Feature: Browser favicon compatibility
  Scenario: Browser icon metadata preserves the SVG with stable raster fallbacks
    Then the page declares stable raster fallbacks and retains its embedded SVG icon

  Scenario Outline: The <filename> compatibility export has a crawlable URL
    Then the hosted favicon "<filename>" is available as "<type>"
    Examples:
      | filename             | type                   |
      | favicon.svg          | image/svg+xml          |
      | favicon.ico          | image/x-icon           |
      | favicon.png          | image/png              |
      | favicon.bmp          | image/bmp              |
      | favicon.gif          | image/gif              |
      | favicon.jpg          | image/jpeg             |
      | favicon.ppm          | image/x-portable-pixmap |
      | favicon.tiff         | image/tiff             |
      | apple-touch-icon.png | image/png              |

  Scenario Outline: Chromium renders the <filename> browser icon
    Then Chromium decodes favicon "<filename>" as <width> by <height> pixels
    Examples:
      | filename             | width | height |
      | favicon.svg          | 64    | 64     |
      | favicon.ico          | 48    | 48     |
      | favicon.png          | 96    | 96     |
      | apple-touch-icon.png | 180   | 180    |
