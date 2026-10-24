# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Workflow operation execution
  Scenario: Execute an operation with typed URL and header inputs
    Then workflow operation execution sends the encoded query and headers and displays the received response

  Scenario: Execute an operation with a structured JSON body
    Then workflow operation execution sends structured JSON and displays the received response

  Scenario: Preserve an unsuccessful HTTP response and retry the request
    Then workflow operation execution displays an HTTP error body and can retry successfully

  Scenario: Recover from a request connection failure
    Then workflow operation execution reports connection failure and can retry successfully

  Scenario: Cancel a pending request without sending duplicate submissions
    Then pending workflow operation execution prevents duplicates and supports cancellation and retry

  Scenario: Quitting a run abandons its unfinished response
    Then switching operation ignores a late response

  Scenario: Example domain operations display the actual endpoint response
    Then workflow example execution displays server data from an actual request

  @chromium-only
  Scenario Outline: Download an exact binary result at <width>px
    Then a binary operation at <width> pixels displays a bounded file and downloads exact bytes
    Examples:
      | width |
      | 390   |
      | 1280  |
