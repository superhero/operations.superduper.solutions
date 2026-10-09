# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Separate mocked and live example schemas
  Scenario: Browse both example schemas and prepare typed query and header inputs
    Then both example catalogs prepare typed query and header values

  Scenario: Validate nested JSON without losing its value types
    Then structured example fields validate JSON and preserve nested types

  Scenario Outline: Run a live example method
    Then the live example sends a "<method>" request
    Examples:
      | method  |
      | GET     |
      | POST    |
      | PUT     |
      | PATCH   |
      | DELETE  |
      | HEAD    |
      | OPTIONS |

  Scenario Outline: Encode a live example body in the browser
    Then the live example encodes a "<body>" body
    Examples:
      | body       |
      | JsonObject |
      | JsonArray  |
      | JsonScalar |
      | PlainText  |
      | UrlEncoded |
      | Multipart  |

  Scenario: Pass a structured mock result into a live example step
    Then a mixed workflow passes a mocked array to the live schema
