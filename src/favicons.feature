# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Browser and search favicon compatibility
  Scenario: Search and browser fallbacks remain ordinary crawlable files
    Then the page offers crawlable raster icons and an embedded SVG

  Scenario Outline: The release contains a real <format> favicon
    Then the hosted "<filename>" favicon has a valid "<format>" image
    Examples:
      | filename             | format |
      | favicon.svg          | svg    |
      | favicon.ico          | ico    |
      | favicon.png          | png    |
      | favicon.bmp          | bmp    |
      | favicon.gif          | gif    |
      | favicon.jpg          | jpeg   |
      | favicon.ppm          | ppm    |
      | favicon.tiff         | tiff   |
      | apple-touch-icon.png | png    |

  Scenario Outline: Supported favicon formats retain their title and attribution
    Then "<filename>" contains the favicon title and attribution in its "<metadata>" metadata
    Examples:
      | filename             | metadata |
      | favicon.svg          | svg      |
      | favicon.png          | xmp      |
      | apple-touch-icon.png | xmp      |
      | favicon.jpg          | xmp      |
      | favicon.tiff         | xmp      |
      | favicon.gif          | gif      |
      | favicon.ppm          | ppm      |

  Scenario Outline: A build cannot silently use outdated icon artwork
    Then the favicon check rejects "<failure>" without rewriting assets
    Examples:
      | failure        |
      | missing output |
      | changed output |
      | changed source |

  Scenario Outline: Regeneration refuses unsafe destinations before any writes
    Then favicon generation refuses a "<failure>" before changing existing assets
    Examples:
      | failure   |
      | symlink   |
      | directory |
