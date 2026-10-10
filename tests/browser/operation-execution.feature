# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Direct operation execution
  Scenario: Execute an operation with typed URL and header inputs
    Then direct execution sends the encoded query and headers and displays the received response

  Scenario: Execute an operation with a structured JSON body
    Then direct execution sends structured JSON and displays the received response

  Scenario: Preserve an unsuccessful HTTP response and retry the request
    Then direct execution displays an HTTP error body and can retry successfully

  Scenario: Recover from a request connection failure
    Then direct execution reports connection failure and can retry successfully

  Scenario: Cancel a pending request without sending duplicate submissions
    Then pending direct execution prevents duplicates and supports cancellation and retry

  Scenario: Changing operations abandons an unfinished response
    Then switching operation ignores a late direct response

  Scenario: Example domain operations display the actual endpoint response
    Then direct example execution displays server data from an actual request
