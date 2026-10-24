# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-files @binary-responses
Feature: Bounded exact-byte workflow downloads
  Scenario Outline: <mode> binary responses preserve bytes and advisory metadata
    Then "<mode>" responses preserve exact declared bytes through mapping and storage
    Examples:
      | mode    |
      | public  |
      | private |

  Scenario Outline: <mode> response readers enforce safe bounded outcomes for <case>
    Then "<mode>" binary response handling rejects "<case>" without exposing a partial file
    Examples:
      | mode    | case              |
      | public  | oversized         |
      | private | oversized         |
      | public  | wrong media       |
      | private | wrong media       |
      | public  | undeclared binary |
      | private | undeclared binary |
      | public  | events            |
      | private | events            |
      | public  | ndjson            |
      | private | ndjson            |
      | public  | aborted           |
      | private | aborted           |
      | public  | broken stream     |
      | private | broken stream     |
      | public  | empty chunks      |
      | private | empty chunks      |

  Scenario: A selected secret in file bytes cannot escape or replay a completed write
    Then credential echoes withhold the entire binary result and stop downstream operations

  Scenario: Binary and JSON representations use actual status and media declarations
    Then response media metadata preserves JSON text and bodyless compatibility and selects matching branches

  Scenario: File response names are safe advisory metadata
    Then binary response filenames cannot supply paths or invalid envelopes

  Scenario: Bundled OpenAI file content uses the native private binary path
    Then the pinned OpenAI file download sends a private bearer and returns exact binary bytes

  Scenario: An exact file representation takes precedence over generic binary
    Then exact binary media mappings run once while the generic fallback stays inactive
