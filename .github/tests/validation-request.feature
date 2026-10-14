# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@validation-request
Feature: Classify GitHub reads without exposing request credentials

  Scenario Outline: The real CLI adapter decodes an included HTTP response
    Given the validation GitHub command returns "<response>"
    When the validation "API" adapter invokes the GitHub command
    Then the validation API response is decoded

    Examples:
      | response        |
      | successful JSON |
      | headerless JSON |

  Scenario Outline: Only known transient CLI failures permit a retry
    Given the validation GitHub command returns "<response>"
    When the validation "<adapter>" adapter invokes the GitHub command
    Then the validation request failure is "<category>" with retry "<retry>"
    And the request diagnostics contain no credentials or response body

    Examples:
      | adapter  | response                     | category         | retry |
      | API      | server 500                   | server           | true  |
      | API      | server 502                   | server           | true  |
      | API      | server 503                   | server           | true  |
      | API      | server 504                   | server           | true  |
      | API      | server 501                   | http             | false |
      | API      | unauthorized 401             | authorization    | false |
      | API      | forbidden 403                | authorization    | false |
      | API      | missing 404                  | not_found        | false |
      | API      | rate limited 429             | rate_limit       | false |
      | API      | exhausted rate limit 403     | rate_limit       | false |
      | API      | server retry-after           | rate_limit       | false |
      | API      | malformed JSON               | invalid_response | false |
      | API      | missing HTTP headers         | invalid_response | false |
      | API      | connection reset             | network          | true  |
      | API      | DNS interruption             | network          | true  |
      | API      | request deadline             | timeout          | true  |
      | API      | unknown CLI failure          | command          | false |
      | download | download server 503          | server           | true  |
      | download | download missing 404         | not_found        | false |
      | download | download rate limit          | rate_limit       | false |
      | download | connection reset             | network          | true  |
      | download | download unexpected EOF      | network          | true  |
      | download | unknown CLI failure          | command          | false |

  Scenario Outline: A timed out CLI process is terminated
    Given the validation GitHub command returns "a hanging process"
    When the validation "<adapter>" adapter invokes the GitHub command
    Then the validation request failure is "timeout" with retry "true"
    And the timed out validation command is no longer running
    And the request diagnostics contain no credentials or response body

    Examples:
      | adapter  |
      | API      |
      | download |
